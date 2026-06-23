"""Single-image camera pose estimator backed by PerspectiveFields.

Returns a Telemetry with `source='estimated'` given a frame and an assumed
altitude. PerspectiveFields gives us roll, pitch, vFOV; we synthesize the
rest from sensible defaults (yaw=0, no lat/lon).
"""
from __future__ import annotations

import threading
import warnings
from typing import Optional

import cv2
import numpy as np
import torch

from crowdcounter.world.telemetry import CameraIntrinsics, Telemetry

# perspective2d is a fat optional import — load lazily
_pf_model = None
_pf_lock = threading.Lock()
_pf_device: Optional[torch.device] = None


def _pick_device() -> torch.device:
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def _load_pf():
    global _pf_model, _pf_device
    with _pf_lock:
        if _pf_model is not None:
            return _pf_model
        warnings.filterwarnings("ignore")
        from perspective2d import PerspectiveFields
        _pf_device = _pick_device()
        m = PerspectiveFields("Paramnet-360Cities-edina-centered").eval()
        m = m.to(_pf_device)
        _pf_model = m
        return m


def is_loaded() -> bool:
    return _pf_model is not None


def device_name() -> str:
    return str(_pf_device) if _pf_device else "—"


def estimate_pose(frame_bgr: np.ndarray, alt_m: float) -> Telemetry:
    """Run PerspectiveFields on one BGR frame, return Telemetry.

    Lazy-loads the model on first call. Subsequent calls are fast.
    """
    model = _load_pf()
    h, w = frame_bgr.shape[:2]

    # PerspectiveFields prefers max-side <=640 for speed; downsize for inference
    scale = min(640 / max(h, w), 1.0)
    if scale < 1.0:
        small = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        small = frame_bgr

    with torch.no_grad():
        pred = model.inference(img_bgr=small)

    roll = float(pred["pred_roll"].item())
    pitch = float(pred["pred_pitch"].item())
    vfov = float(pred["pred_vfov"].item())

    intrinsics = CameraIntrinsics.from_vfov(vfov, w, h)

    # confidence: assume high when pitch is between -90 (nadir) and 0 (horizon),
    # lower when extreme (model less reliable on weird angles)
    confidence = 1.0 - min(1.0, abs(pitch + 45) / 90)
    confidence = max(0.3, confidence)

    return Telemetry(
        alt_m=alt_m,
        pitch_deg=pitch,
        roll_deg=roll,
        yaw_deg=0.0,
        intrinsics=intrinsics,
        source="estimated",
        confidence=confidence,
    )
