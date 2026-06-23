"""YOLO11 + ByteTrack person detector / tracker.

One global model, lazy-loaded. ByteTrack state is kept inside the Ultralytics
predictor and shared by all callers, so realistically this assumes a single
active stream at a time — `reset_tracker()` wipes the IDs between streams.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import torch

from crowdcounter.core.paths import weights_root

# Default checkpoint. yolo11x = best accuracy (~110 MB).
# Swap to yolo11l for ~3x speed if needed; same API.
WEIGHTS_FILENAME = "yolo11x.pt"
PERSON_CLASS_ID = 0  # COCO


@dataclass
class Detection:
    track_id: int
    cx: float
    cy: float
    bbox: tuple[float, float, float, float]  # x, y, w, h (top-left + size)
    conf: float


class DetectorHolder:
    """Thread-safe lazy loader for YOLO + ByteTrack."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._device: Optional[str] = None
        self._weights_source: Optional[str] = None
        self._weights_path: Optional[Path] = None

    @staticmethod
    def _pick_device() -> str:
        if torch.backends.mps.is_available() and torch.backends.mps.is_built():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"

    def is_loaded(self) -> bool:
        return self._model is not None

    def weights_source(self) -> Optional[str]:
        return self._weights_source

    def device_name(self) -> str:
        return self._device or "—"

    def load(self) -> bool:
        with self._lock:
            if self._model is not None:
                return True
            # Import lazily — ultralytics pulls a lot in.
            from ultralytics import YOLO

            path = weights_root() / WEIGHTS_FILENAME
            # ultralytics auto-downloads from its CDN if the file is missing.
            model = YOLO(str(path))
            device = self._pick_device()
            # Warm up so the first frame doesn't pay JIT cost.
            try:
                dummy = np.zeros((640, 640, 3), dtype=np.uint8)
                model.predict(dummy, device=device, verbose=False, classes=[PERSON_CLASS_ID])
            except Exception:
                pass
            self._model = model
            self._device = device
            self._weights_source = path.name
            self._weights_path = path
            return True

    def reset_tracker(self) -> None:
        """Wipe ByteTrack state so a new stream starts at id=1."""
        with self._lock:
            if self._model is None:
                return
            predictor = getattr(self._model, "predictor", None)
            if predictor is not None and getattr(predictor, "trackers", None):
                predictor.trackers = None

    def track(self, frame_bgr: np.ndarray, conf: float = 0.25) -> list[Detection]:
        """Run one tracked inference pass on a BGR frame. Returns Detections
        with persistent track IDs (within the current stream)."""
        if self._model is None:
            self.load()
        results = self._model.track(
            frame_bgr,
            persist=True,
            tracker="bytetrack.yaml",
            classes=[PERSON_CLASS_ID],
            conf=conf,
            device=self._device,
            verbose=False,
        )
        if not results:
            return []
        r = results[0]
        if r.boxes is None or r.boxes.id is None:
            return []
        xywh = r.boxes.xywh.cpu().numpy()        # (N, 4) — cx, cy, w, h
        ids = r.boxes.id.cpu().numpy().astype(int)  # (N,)
        confs = r.boxes.conf.cpu().numpy()         # (N,)
        out: list[Detection] = []
        for (cx, cy, w, h), tid, c in zip(xywh, ids, confs):
            out.append(Detection(
                track_id=int(tid),
                cx=float(cx),
                cy=float(cy),
                bbox=(float(cx - w / 2), float(cy - h / 2), float(w), float(h)),
                conf=float(c),
            ))
        return out


DETECTOR = DetectorHolder()
