"""
P2PNet — Purely Point-based crowd counting.

Faithful re-implementation of the official architecture from:
  "Rethinking Counting and Localization in Crowds: A Purely Point-Based Framework"
  Song et al., ICCV 2021.
  TencentYoutuResearch/CrowdCounting-P2PNet (MIT-ish, attribution to Facebook DETR base).

Structured to load the official SHTechA.pth state_dict directly.
"""
from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
from torchvision import models


# ---------- backbone ----------

class VGGBackbone(nn.Module):
    """VGG16-BN split into 4 bodies. Outputs features at strides {2, 4, 8, 16}."""

    def __init__(self) -> None:
        super().__init__()
        vgg = models.vgg16_bn(weights=None)
        feats = list(vgg.features.children())
        self.body1 = nn.Sequential(*feats[:13])   # stride 2
        self.body2 = nn.Sequential(*feats[13:23]) # stride 4 (256ch) — used as C3
        self.body3 = nn.Sequential(*feats[23:33]) # stride 8 (512ch) — used as C4
        self.body4 = nn.Sequential(*feats[33:43]) # stride 16 (512ch) — used as C5

    def forward(self, x: torch.Tensor) -> list[torch.Tensor]:
        out = []
        for layer in (self.body1, self.body2, self.body3, self.body4):
            x = layer(x)
            out.append(x)
        return out


# ---------- FPN-style decoder ----------

class Decoder(nn.Module):
    def __init__(self, c3_size: int = 256, c4_size: int = 512, c5_size: int = 512, feature_size: int = 256) -> None:
        super().__init__()
        self.P5_1 = nn.Conv2d(c5_size, feature_size, kernel_size=1)
        self.P5_upsampled = nn.Upsample(scale_factor=2, mode="nearest")
        self.P5_2 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)

        self.P4_1 = nn.Conv2d(c4_size, feature_size, kernel_size=1)
        self.P4_upsampled = nn.Upsample(scale_factor=2, mode="nearest")
        self.P4_2 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)

        self.P3_1 = nn.Conv2d(c3_size, feature_size, kernel_size=1)
        self.P3_upsampled = nn.Upsample(scale_factor=2, mode="nearest")
        self.P3_2 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)

    def forward(self, inputs: list[torch.Tensor]) -> list[torch.Tensor]:
        C3, C4, C5 = inputs
        P5_x = self.P5_1(C5)
        P5_up = self.P5_upsampled(P5_x)
        P5_x = self.P5_2(P5_x)

        P4_x = self.P4_1(C4) + P5_up
        P4_up = self.P4_upsampled(P4_x)
        P4_x = self.P4_2(P4_x)

        P3_x = self.P3_1(C3) + P4_up
        P3_x = self.P3_2(P3_x)
        return [P3_x, P4_x, P5_x]


# ---------- anchor points ----------

def _generate_anchor_offsets(stride: int, row: int, line: int) -> np.ndarray:
    row_step = stride / row
    line_step = stride / line
    shift_x = (np.arange(1, line + 1) - 0.5) * line_step - stride / 2
    shift_y = (np.arange(1, row + 1) - 0.5) * row_step - stride / 2
    sx, sy = np.meshgrid(shift_x, shift_y)
    return np.vstack([sx.ravel(), sy.ravel()]).T  # (row*line, 2)


def _shift(shape: tuple[int, int], stride: int, offsets: np.ndarray) -> np.ndarray:
    h, w = shape
    shift_x = (np.arange(0, w) + 0.5) * stride
    shift_y = (np.arange(0, h) + 0.5) * stride
    sx, sy = np.meshgrid(shift_x, shift_y)
    shifts = np.vstack([sx.ravel(), sy.ravel()]).T  # (K, 2)
    A = offsets.shape[0]
    K = shifts.shape[0]
    pts = offsets.reshape(1, A, 2) + shifts.reshape(K, 1, 2)
    return pts.reshape(K * A, 2)


class AnchorPoints(nn.Module):
    def __init__(self, pyramid_levels: list[int] | None = None, row: int = 2, line: int = 2) -> None:
        super().__init__()
        self.pyramid_levels = pyramid_levels or [3]
        self.strides = [2 ** p for p in self.pyramid_levels]
        self.row = row
        self.line = line

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        img_shape = np.array(image.shape[2:])
        shapes = [(img_shape + 2 ** p - 1) // (2 ** p) for p in self.pyramid_levels]
        all_pts = np.zeros((0, 2), dtype=np.float32)
        for i, p in enumerate(self.pyramid_levels):
            offsets = _generate_anchor_offsets(2 ** p, self.row, self.line)
            pts = _shift(tuple(shapes[i]), self.strides[i], offsets)
            all_pts = np.vstack([all_pts, pts.astype(np.float32)])
        return torch.from_numpy(all_pts).to(image.device).unsqueeze(0)


# ---------- heads ----------
# NOTE: the official P2PNet defines 4 conv layers in each head but only uses
# conv1 + conv2 + output in forward(). We mirror that quirk so the state_dict
# loads cleanly even though conv3/conv4 are dead weights.

class RegressionModel(nn.Module):
    def __init__(self, in_channels: int = 256, num_anchor_points: int = 4, feature_size: int = 256) -> None:
        super().__init__()
        self.conv1 = nn.Conv2d(in_channels, feature_size, kernel_size=3, padding=1)
        self.act1 = nn.ReLU(inplace=True)
        self.conv2 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)
        self.act2 = nn.ReLU(inplace=True)
        # parity weights — present in checkpoint but unused in forward
        self.conv3 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)
        self.conv4 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)
        self.output = nn.Conv2d(feature_size, num_anchor_points * 2, kernel_size=3, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.act1(self.conv1(x))
        x = self.act2(self.conv2(x))
        x = self.output(x)
        x = x.permute(0, 2, 3, 1).contiguous()
        return x.view(x.shape[0], -1, 2)


class ClassificationModel(nn.Module):
    def __init__(
        self, in_channels: int = 256, num_anchor_points: int = 4, num_classes: int = 2, feature_size: int = 256
    ) -> None:
        super().__init__()
        self.num_classes = num_classes
        self.num_anchor_points = num_anchor_points
        self.conv1 = nn.Conv2d(in_channels, feature_size, kernel_size=3, padding=1)
        self.act1 = nn.ReLU(inplace=True)
        self.conv2 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)
        self.act2 = nn.ReLU(inplace=True)
        self.conv3 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)
        self.conv4 = nn.Conv2d(feature_size, feature_size, kernel_size=3, padding=1)
        self.output = nn.Conv2d(feature_size, num_anchor_points * num_classes, kernel_size=3, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.act1(self.conv1(x))
        x = self.act2(self.conv2(x))
        x = self.output(x)
        x = x.permute(0, 2, 3, 1).contiguous()
        return x.view(x.shape[0], -1, self.num_classes)


# ---------- model ----------

class P2PNet(nn.Module):
    def __init__(self, row: int = 2, line: int = 2) -> None:
        super().__init__()
        self.num_classes = 2
        num_anchor_points = row * line

        self.backbone = VGGBackbone()
        self.fpn = Decoder(256, 512, 512)
        self.regression = RegressionModel(256, num_anchor_points)
        self.classification = ClassificationModel(256, num_anchor_points, self.num_classes)
        self.anchor_points = AnchorPoints(pyramid_levels=[3], row=row, line=line)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        feats = self.backbone(x)
        fpn_out = self.fpn([feats[1], feats[2], feats[3]])
        # heads operate on P4 features (stride 8)
        reg = self.regression(fpn_out[1]) * 100.0
        cls = self.classification(fpn_out[1])
        anchors = self.anchor_points(x).expand(x.shape[0], -1, -1)
        return {"pred_logits": cls, "pred_points": reg + anchors}


def build_p2pnet(row: int = 2, line: int = 2) -> P2PNet:
    return P2PNet(row=row, line=line)


def load_pretrained(model: P2PNet, weights_path: str) -> dict:
    ckpt = torch.load(weights_path, map_location="cpu", weights_only=False)
    state_dict = ckpt.get("model", ckpt.get("state_dict", ckpt))
    return model.load_state_dict(state_dict, strict=True)
