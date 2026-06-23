from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from PIL import Image
from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from core.dataset import (
    Annotation,
    AnnotationPoint,
    load_annotation,
    save_annotation,
)
from core.fetcher import download_collection
from core.inference import MODEL, density_from_points, infer_image
from core.paths import collection_root
from app.sidecar.registry import get_collection, load_registry

app = FastAPI(title="Crowd Counter Sidecar")
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


# ---------- health ----------

class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    weights_source: str | None = None
    device: str | None = None


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    loaded = MODEL.is_loaded()
    return HealthResponse(
        status="ok",
        model_loaded=loaded,
        weights_source=MODEL.weights_source(),
        device=MODEL.device_name() if loaded else None,
    )


@app.post("/model/load")
def model_load() -> dict:
    ok = MODEL.reload()
    return {
        "loaded": ok,
        "weights_source": MODEL.weights_source(),
        "device": MODEL.device_name() if ok else None,
    }


# ---------- collections ----------

class CollectionSummary(BaseModel):
    id: str
    name: str
    kind: str
    region: str
    density: str
    description: str
    pre_annotated: bool
    download_size_bytes: int | None
    manifest_count: int
    downloaded_count: int
    annotated_count: int


def _summary(c) -> CollectionSummary:
    root = collection_root(c.id)
    images = list((root / "images").iterdir()) if (root / "images").exists() else []
    image_files = [p for p in images if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    ann_dir = root / "annotations"
    annotated = list(ann_dir.glob("*.json")) if ann_dir.exists() else []
    return CollectionSummary(
        id=c.id,
        name=c.name,
        kind=c.kind,
        region=c.region,
        density=c.density,
        description=c.description,
        pre_annotated=c.pre_annotated,
        download_size_bytes=c.download_size_bytes,
        manifest_count=len(c.images),
        downloaded_count=len(image_files),
        annotated_count=len(annotated),
    )


@app.get("/collections", response_model=list[CollectionSummary])
def list_collections() -> list[CollectionSummary]:
    return [_summary(c) for c in load_registry()]


@app.get("/collections/{collection_id}", response_model=CollectionSummary)
def get_collection_summary(collection_id: str) -> CollectionSummary:
    c = get_collection(collection_id)
    if c is None:
        raise HTTPException(404, "collection not found")
    return _summary(c)


class CollectionImageEntry(BaseModel):
    name: str
    annotated: bool
    count: int | None = None


@app.get("/collections/{collection_id}/images", response_model=list[CollectionImageEntry])
def list_collection_images(collection_id: str) -> list[CollectionImageEntry]:
    c = get_collection(collection_id)
    if c is None:
        raise HTTPException(404, "collection not found")
    root = collection_root(collection_id)
    images_dir = root / "images"
    if not images_dir.exists():
        return []
    out: list[CollectionImageEntry] = []
    for p in sorted(images_dir.iterdir()):
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        ann = load_annotation(root, p.name)
        out.append(
            CollectionImageEntry(
                name=p.name,
                annotated=ann is not None and ann.reviewed,
                count=len(ann.points) if ann else None,
            )
        )
    return out


@app.get("/collections/{collection_id}/images/{image_name}")
def get_collection_image(collection_id: str, image_name: str):
    root = collection_root(collection_id)
    path = root / "images" / image_name
    if not path.exists():
        raise HTTPException(404, "image not found")
    return FileResponse(path)


@app.websocket("/collections/{collection_id}/download")
async def ws_download(ws: WebSocket, collection_id: str) -> None:
    await ws.accept()
    c = get_collection(collection_id)
    if c is None:
        await ws.send_json({"phase": "error", "message": "collection not found"})
        await ws.close()
        return
    try:
        async for evt in download_collection(c):
            await ws.send_json(asdict(evt))
    except WebSocketDisconnect:
        return
    except Exception as e:
        await ws.send_json({"phase": "error", "message": str(e)})
    finally:
        try:
            await ws.close()
        except RuntimeError:
            pass


# ---------- annotations ----------

class AnnotationPayload(BaseModel):
    points: list[dict]
    image_size: tuple[int, int]
    reviewed: bool = False


@app.get("/collections/{collection_id}/annotations/{image_name}")
def get_annotation(collection_id: str, image_name: str):
    c = get_collection(collection_id)
    if c is None:
        raise HTTPException(404, "collection not found")
    root = collection_root(collection_id)
    ann = load_annotation(root, image_name)
    if ann is None:
        return Response(status_code=204)
    return asdict(ann)


@app.put("/collections/{collection_id}/annotations/{image_name}")
def put_annotation(collection_id: str, image_name: str, body: AnnotationPayload):
    c = get_collection(collection_id)
    if c is None:
        raise HTTPException(404, "collection not found")
    root = collection_root(collection_id)
    ann = Annotation(
        image_name=image_name,
        points=[AnnotationPoint(**p) for p in body.points],
        image_size=body.image_size,
        region=c.region,
        density=c.density,
        reviewed=body.reviewed,
    )
    path = save_annotation(root, ann)
    return {"saved": str(path), "count": len(ann.points)}


# ---------- inference ----------

class Point(BaseModel):
    x: float
    y: float
    confidence: float


class InferResponse(BaseModel):
    points: list[Point]
    peak_xy: tuple[int, int]
    count: int
    image_size: tuple[int, int]


def _run_inference(pil: Image.Image, threshold: float) -> InferResponse:
    if MODEL.is_loaded() or MODEL.load():
        r = infer_image(pil, threshold=threshold)
        return InferResponse(
            points=[Point(x=x, y=y, confidence=c) for (x, y, c) in r.points],
            peak_xy=r.peak_xy,
            count=r.count,
            image_size=r.image_size,
        )
    # fallback stub when no weights are available
    w, h = pil.size
    rng = np.random.default_rng(seed=hash(pil.tobytes()[:128]) & 0xFFFFFFFF)
    n = int(rng.integers(20, 80))
    cx, cy = rng.uniform(0, w), rng.uniform(0, h)
    pts = np.column_stack([
        np.clip(rng.normal(cx, w / 6, n), 0, w - 1),
        np.clip(rng.normal(cy, h / 6, n), 0, h - 1),
    ])
    confs = rng.uniform(0.4, 0.99, n)
    pts_xy = [(float(x), float(y)) for x, y in pts]
    _, peak = density_from_points(pts_xy, (w, h))
    return InferResponse(
        points=[Point(x=x, y=y, confidence=float(c)) for (x, y), c in zip(pts_xy, confs)],
        peak_xy=peak,
        count=n,
        image_size=(w, h),
    )


@app.post("/infer", response_model=InferResponse)
async def infer_upload(image: UploadFile = File(...), threshold: float = 0.5) -> InferResponse:
    pil = Image.open(image.file).convert("RGB")
    return _run_inference(pil, threshold)


@app.post("/collections/{collection_id}/infer/{image_name}", response_model=InferResponse)
def infer_collection_image(collection_id: str, image_name: str, threshold: float = 0.5) -> InferResponse:
    root = collection_root(collection_id)
    path = root / "images" / image_name
    if not path.exists():
        raise HTTPException(404, "image not found")
    pil = Image.open(path).convert("RGB")
    return _run_inference(pil, threshold)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17893)
    args = parser.parse_args()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
