"""FastAPI server. Serves the live view UI and the inference endpoints."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from crowdcounter.core.inference import MODEL, infer_image
from crowdcounter.videos import VideoInfo, list_videos, stream_video

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
    threading.Thread(target=MODEL.load, daemon=True).start()


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    weights_source: str | None = None
    device: str | None = None


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    loaded = MODEL.is_loaded()
    return HealthResponse(
        status="ok",
        model_loaded=loaded,
        weights_source=MODEL.weights_source(),
        device=MODEL.device_name() if loaded else None,
    )


class Point(BaseModel):
    x: float
    y: float
    confidence: float


class InferResponse(BaseModel):
    points: list[Point]
    peak_xy: tuple[int, int]
    count: int
    image_size: tuple[int, int]


@app.post("/api/infer", response_model=InferResponse)
async def infer(image: UploadFile = File(...), threshold: float = 0.5) -> InferResponse:
    pil = Image.open(image.file).convert("RGB")
    if not MODEL.is_loaded():
        if not MODEL.load():
            raise HTTPException(503, "model weights not available")
    r = infer_image(pil, threshold=threshold)
    return InferResponse(
        points=[Point(x=x, y=y, confidence=c) for (x, y, c) in r.points],
        peak_xy=r.peak_xy,
        count=r.count,
        image_size=r.image_size,
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
