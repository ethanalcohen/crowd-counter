"""FastAPI server. Serves the live view UI and the inference endpoints."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from crowdcounter.core.clustering import cluster_centroid
from crowdcounter.core.detector import DETECTOR
from crowdcounter.videos import list_videos, stream_video

WEB_DIST = Path(__file__).resolve().parents[1] / "web" / "dist"

app = FastAPI(title="Crowd Counter")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _autoload_model() -> None:
    import threading
    threading.Thread(target=DETECTOR.load, daemon=True).start()


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    weights_source: str | None = None
    device: str | None = None


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    loaded = DETECTOR.is_loaded()
    return HealthResponse(
        status="ok",
        model_loaded=loaded,
        weights_source=DETECTOR.weights_source(),
        device=DETECTOR.device_name() if loaded else None,
    )


class DetectionOut(BaseModel):
    id: int
    cx: float
    cy: float
    bbox: tuple[float, float, float, float]
    conf: float


class InferResponse(BaseModel):
    detections: list[DetectionOut]
    cluster_xy: tuple[float, float] | None
    count: int
    image_size: tuple[int, int]


@app.post("/api/infer", response_model=InferResponse)
async def infer(image: UploadFile = File(...)) -> InferResponse:
    """Single-frame detection. ByteTrack state is reset so IDs are per-call."""
    pil = Image.open(image.file).convert("RGB")
    if not DETECTOR.is_loaded():
        if not DETECTOR.load():
            raise HTTPException(503, "model weights not available")
    arr_rgb = np.asarray(pil)
    arr_bgr = cv2.cvtColor(arr_rgb, cv2.COLOR_RGB2BGR)
    DETECTOR.reset_tracker()
    dets = DETECTOR.track(arr_bgr)
    w, h = pil.size
    cluster = cluster_centroid([(d.cx, d.cy) for d in dets], (w, h))
    return InferResponse(
        detections=[
            DetectionOut(id=d.track_id, cx=d.cx, cy=d.cy, bbox=d.bbox, conf=d.conf)
            for d in dets
        ],
        cluster_xy=(cluster.cx, cluster.cy) if cluster else None,
        count=len(dets),
        image_size=(w, h),
    )


# ---------- video ----------

@app.get("/api/videos", response_model=list[dict])
def videos_index() -> list[dict]:
    return [v.__dict__ for v in list_videos()]


@app.websocket("/api/video/{video_id}/stream")
async def video_stream(ws: WebSocket, video_id: str) -> None:
    await ws.accept()
    await stream_video(ws, video_id)


# Serve the built Svelte app at /. During dev the Vite server runs on :5173;
# in production the static build is mounted here.
if WEB_DIST.exists():
    app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")
