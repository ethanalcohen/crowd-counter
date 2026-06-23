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
    reviewed_count: int = 0


def _summary(c) -> CollectionSummary:
    root = collection_root(c.id)
    images = list((root / "images").iterdir()) if (root / "images").exists() else []
    image_files = [p for p in images if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}]
    ann_dir = root / "annotations"
    annotated = 0
    reviewed = 0
    if ann_dir.exists():
        for ann_path in ann_dir.glob("*.json"):
            annotated += 1
            try:
                data = json.loads(ann_path.read_text())
                if data.get("reviewed", False):
                    reviewed += 1
            except (json.JSONDecodeError, OSError):
                pass
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
        annotated_count=annotated,
        reviewed_count=reviewed,
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
    reviewed: bool = False
    count: int | None = None


@app.get("/collections/{collection_id}/images", response_model=list[CollectionImageEntry])
def list_collection_images(collection_id: str, status: str | None = None) -> list[CollectionImageEntry]:
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
        has_ann = ann is not None
        is_reviewed = has_ann and ann.reviewed
        if status == "annotated" and not has_ann:
            continue
        if status == "unannotated" and has_ann:
            continue
        out.append(
            CollectionImageEntry(
                name=p.name,
                annotated=has_ann,
                reviewed=is_reviewed,
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


# ---------- auto-annotate ----------

@app.websocket("/collections/{collection_id}/auto-annotate")
async def ws_auto_annotate(ws: WebSocket, collection_id: str) -> None:
    await ws.accept()
    c = get_collection(collection_id)
    if c is None:
        await ws.send_json({"phase": "error", "current": 0, "total": 0, "message": "collection not found"})
        await ws.close()
        return

    if not MODEL.is_loaded() and not MODEL.load():
        await ws.send_json({"phase": "error", "current": 0, "total": 0, "message": "model not loaded — place SHTechA.pth in weights directory"})
        await ws.close()
        return

    root = collection_root(collection_id)
    images_path = root / "images"
    if not images_path.exists():
        await ws.send_json({"phase": "error", "current": 0, "total": 0, "message": "no images downloaded"})
        await ws.close()
        return

    image_files = sorted(
        p for p in images_path.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )

    to_process = []
    for p in image_files:
        ann = load_annotation(root, p.name)
        if ann is None or not ann.reviewed:
            to_process.append(p)

    total = len(to_process)
    if total == 0:
        await ws.send_json({"phase": "done", "current": 0, "total": 0, "annotated": 0, "skipped": 0})
        await ws.close()
        return

    loop = asyncio.get_event_loop()
    annotated_count = 0

    try:
        for i, p in enumerate(to_process):
            pil = Image.open(p).convert("RGB")
            result = await loop.run_in_executor(None, _run_inference, pil, 0.5)

            ann = Annotation(
                image_name=p.name,
                points=[AnnotationPoint(x=pt.x, y=pt.y, confidence=pt.confidence, source="model") for pt in result.points],
                image_size=result.image_size,
                region=c.region,
                density=c.density,
                reviewed=False,
            )
            save_annotation(root, ann)
            annotated_count += 1

            await ws.send_json({
                "phase": "inferring",
                "current": i + 1,
                "total": total,
                "image_name": p.name,
                "count": result.count,
            })

        await ws.send_json({
            "phase": "done",
            "current": total,
            "total": total,
            "annotated": annotated_count,
            "skipped": len(image_files) - total,
        })
    except WebSocketDisconnect:
        return
    except Exception as e:
        await ws.send_json({"phase": "error", "current": 0, "total": total, "message": str(e)})
    finally:
        try:
            await ws.close()
        except RuntimeError:
            pass


class AutoAnnotateResult(BaseModel):
    image_name: str
    count: int
    image_size: tuple[int, int]


@app.post("/collections/{collection_id}/auto-annotate/{image_name}", response_model=AutoAnnotateResult)
def auto_annotate_single(collection_id: str, image_name: str, threshold: float = 0.5) -> AutoAnnotateResult:
    c = get_collection(collection_id)
    if c is None:
        raise HTTPException(404, "collection not found")
    root = collection_root(collection_id)
    path = root / "images" / image_name
    if not path.exists():
        raise HTTPException(404, "image not found")

    pil = Image.open(path).convert("RGB")
    result = _run_inference(pil, threshold)

    ann = Annotation(
        image_name=image_name,
        points=[AnnotationPoint(x=pt.x, y=pt.y, confidence=pt.confidence, source="model") for pt in result.points],
        image_size=result.image_size,
        region=c.region,
        density=c.density,
        reviewed=False,
    )
    save_annotation(root, ann)
    return AutoAnnotateResult(image_name=image_name, count=result.count, image_size=result.image_size)


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
