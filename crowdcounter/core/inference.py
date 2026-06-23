from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from PIL import Image
from torchvision import transforms

from crowdcounter.core.model.p2pnet import P2PNet, build_p2pnet, load_pretrained
from crowdcounter.core.paths import weights_root


WEIGHTS_FILENAME = "SHTechA.pth"
FINETUNED_FILENAME = "p2pnet_finetuned.pth"

_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD = [0.229, 0.224, 0.225]


@dataclass
class InferenceResult:
    points: list[tuple[float, float, float]]   # (x, y, confidence)
    density_map: np.ndarray
    peak_xy: tuple[int, int]
    count: int
    image_size: tuple[int, int]                # (width, height)


# ---------- density helper (kept for the sidecar stub fallback / UI parity) ----------

def density_from_points(
    points: list[tuple[float, float]],
    image_size: tuple[int, int],
    sigma: float = 8.0,
    downsample: int = 4,
) -> tuple[np.ndarray, tuple[int, int]]:
    w, h = image_size
    dh, dw = h // downsample, w // downsample
    heatmap = np.zeros((dh, dw), dtype=np.float32)
    if not points:
        return heatmap, (0, 0)

    radius = int(sigma * 3)
    for x, y in points:
        cx, cy = int(x / downsample), int(y / downsample)
        x0, x1 = max(0, cx - radius), min(dw, cx + radius + 1)
        y0, y1 = max(0, cy - radius), min(dh, cy + radius + 1)
        if x0 >= x1 or y0 >= y1:
            continue
        xs = np.arange(x0, x1) - cx
        ys = np.arange(y0, y1) - cy
        gx = np.exp(-(xs ** 2) / (2 * sigma ** 2))
        gy = np.exp(-(ys ** 2) / (2 * sigma ** 2))
        heatmap[y0:y1, x0:x1] += np.outer(gy, gx)

    flat_idx = int(np.argmax(heatmap))
    py, px = divmod(flat_idx, dw)
    peak_xy = (px * downsample, py * downsample)
    return heatmap, peak_xy


# ---------- model holder ----------

class ModelHolder:
    """Thread-safe lazy loader for the P2PNet model."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model: Optional[P2PNet] = None
        self._device: Optional[torch.device] = None
        self._weights_source: Optional[str] = None

    def _pick_device(self) -> torch.device:
        if torch.backends.mps.is_available() and torch.backends.mps.is_built():
            return torch.device("mps")
        if torch.cuda.is_available():
            return torch.device("cuda")
        return torch.device("cpu")

    def _resolve_weights_path(self) -> Optional[Path]:
        root = weights_root()
        finetuned = root / FINETUNED_FILENAME
        if finetuned.exists():
            return finetuned
        base = root / WEIGHTS_FILENAME
        if base.exists():
            return base
        return None

    def is_loaded(self) -> bool:
        return self._model is not None

    def weights_source(self) -> Optional[str]:
        return self._weights_source

    def device_name(self) -> str:
        return str(self._device) if self._device else "—"

    def load(self) -> bool:
        with self._lock:
            if self._model is not None:
                return True
            path = self._resolve_weights_path()
            if path is None:
                return False
            device = self._pick_device()
            model = build_p2pnet().to(device).eval()
            load_pretrained(model, str(path))
            self._model = model
            self._device = device
            self._weights_source = path.name
            return True

    def reload(self) -> bool:
        with self._lock:
            self._model = None
            self._device = None
            self._weights_source = None
        return self.load()

    def model(self) -> Optional[P2PNet]:
        if not self.is_loaded():
            self.load()
        return self._model

    def device(self) -> Optional[torch.device]:
        return self._device


MODEL = ModelHolder()


# ---------- inference ----------

def _resize_for_inference(pil: Image.Image, max_size: int = 1408) -> tuple[Image.Image, float]:
    """Resize so longest side ≤ max_size, both dims rounded down to multiple of 128
    (required because P2PNet uses stride 16 backbone × additional upsampling — 128 is safe).
    Returns (resized image, scale factor used for forward direction).
    """
    w, h = pil.size
    scale = min(max_size / max(w, h), 1.0)
    nw = max(128, int(round(w * scale / 128)) * 128)
    nh = max(128, int(round(h * scale / 128)) * 128)
    scale_x = nw / w
    scale_y = nh / h
    resized = pil.resize((nw, nh), Image.BILINEAR)
    return resized, (scale_x, scale_y)


_to_tensor = transforms.Compose([
    transforms.ToTensor(),
    transforms.Normalize(mean=_IMAGENET_MEAN, std=_IMAGENET_STD),
])


def infer_image(pil: Image.Image, threshold: float = 0.5) -> InferenceResult:
    orig_w, orig_h = pil.size

    if not MODEL.is_loaded():
        MODEL.load()
    model = MODEL.model()
    if model is None:
        raise RuntimeError(
            "P2PNet weights not loaded. Place SHTechA.pth in "
            "~/Library/Application Support/CrowdCounter/weights/"
        )
    device = MODEL.device()

    resized, (sx, sy) = _resize_for_inference(pil)
    x = _to_tensor(resized).unsqueeze(0).to(device)

    with torch.no_grad():
        out = model(x)
    pred_points = out["pred_points"][0].cpu().numpy()       # (N, 2) — in resized coords
    pred_scores = out["pred_logits"][0].softmax(dim=-1)[:, 1].cpu().numpy()  # (N,) person prob

    keep = pred_scores >= threshold
    pts_resized = pred_points[keep]
    scores = pred_scores[keep]

    # rescale to original image coordinates
    pts = pts_resized.copy()
    pts[:, 0] /= sx
    pts[:, 1] /= sy
    # clip
    pts[:, 0] = np.clip(pts[:, 0], 0, orig_w - 1)
    pts[:, 1] = np.clip(pts[:, 1], 0, orig_h - 1)

    points_list = [(float(p[0]), float(p[1]), float(s)) for p, s in zip(pts, scores)]
    heatmap, peak_xy = density_from_points(
        [(p[0], p[1]) for p in points_list], (orig_w, orig_h)
    )

    return InferenceResult(
        points=points_list,
        density_map=heatmap,
        peak_xy=peak_xy,
        count=len(points_list),
        image_size=(orig_w, orig_h),
    )
