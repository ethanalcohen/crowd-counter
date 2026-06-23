"""Video registry + per-frame inference streaming."""
from __future__ import annotations

import asyncio
import base64
import io
import json
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from crowdcounter.core.inference import MODEL, density_from_points, infer_image
from crowdcounter.core.paths import app_data_root

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}


def videos_root() -> Path:
    p = app_data_root() / "videos"
    p.mkdir(parents=True, exist_ok=True)
    return p


@dataclass
class VideoInfo:
    id: str
    name: str
    path: str
    duration_s: float
    fps: float
    width: int
    height: int
    frame_count: int
    size_bytes: int


def _probe(path: Path) -> VideoInfo | None:
    try:
        cap = cv2.VideoCapture(str(path))
        if not cap.isOpened():
            return None
        fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        cap.release()
        duration = frame_count / fps if fps > 0 else 0.0
        return VideoInfo(
            id=path.stem,
            name=path.stem,
            path=str(path),
            duration_s=duration,
            fps=fps,
            width=w,
            height=h,
            frame_count=frame_count,
            size_bytes=path.stat().st_size,
        )
    except Exception:
        return None


def list_videos() -> list[VideoInfo]:
    out: list[VideoInfo] = []
    for p in sorted(videos_root().iterdir()):
        if p.suffix.lower() not in VIDEO_EXTS:
            continue
        info = _probe(p)
        if info:
            out.append(info)
    return out


def get_video(video_id: str) -> VideoInfo | None:
    for v in list_videos():
        if v.id == video_id:
            return v
    return None


# ---------- frame encoding ----------

def _encode_jpeg(arr_bgr: np.ndarray, quality: int = 80, max_width: int | None = 1280) -> bytes:
    h, w = arr_bgr.shape[:2]
    if max_width and w > max_width:
        scale = max_width / w
        arr_bgr = cv2.resize(arr_bgr, (max_width, int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", arr_bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    return buf.tobytes() if ok else b""


def _render_heatmap_image(
    points: list[tuple[float, float]], image_size: tuple[int, int], target_w: int = 256
) -> bytes:
    """Compute a Gaussian density map and encode as a small JPEG with a viridis-ish ramp."""
    w, h = image_size
    if not points:
        # transparent-ish blank
        blank = np.zeros((max(h // 8, 32), max(w // 8, 32), 3), dtype=np.uint8)
        return _encode_jpeg(blank, quality=70)

    heat, _ = density_from_points(points, image_size, sigma=12, downsample=8)
    v = heat / (heat.max() + 1e-8)
    # red->orange->yellow ramp (BGR for cv2)
    r = np.clip(0.2 + v * 1.5, 0, 1)
    g = np.clip((v - 0.3) * 1.5, 0, 1)
    b = np.clip(0.5 - v, 0, 1)
    bgr = np.stack([b, g, r], axis=-1)
    bgr = (bgr * 255).astype(np.uint8)
    # zero-out near-zero pixels so the overlay looks transparent on dark video
    mask = (v > 0.02).astype(np.uint8)[:, :, None]
    bgr = bgr * mask

    new_h = int(target_w * bgr.shape[0] / bgr.shape[1])
    bgr = cv2.resize(bgr, (target_w, new_h), interpolation=cv2.INTER_LINEAR)
    return _encode_jpeg(bgr, quality=75, max_width=None)


# ---------- streaming ----------

@dataclass
class StreamControl:
    playing: bool = True
    target_fps: float = 2.0
    seek_frame: int | None = None
    closed: bool = False


def _bgr_to_pil(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


async def stream_video(ws, video_id: str) -> None:
    """One WebSocket per playing video. Server is the timekeeper."""
    info = get_video(video_id)
    if info is None:
        await ws.send_json({"error": "video not found"})
        await ws.close()
        return

    control = StreamControl()

    # listen for control messages in parallel
    async def reader():
        try:
            while not control.closed:
                msg = await ws.receive_json()
                if msg.get("action") == "play":
                    control.playing = True
                elif msg.get("action") == "pause":
                    control.playing = False
                elif msg.get("action") == "seek":
                    control.seek_frame = int(msg.get("frame", 0))
                elif msg.get("action") == "fps":
                    control.target_fps = float(msg.get("fps", 2.0))
        except Exception:
            control.closed = True

    reader_task = asyncio.create_task(reader())

    cap = cv2.VideoCapture(info.path)

    # send info first
    await ws.send_json({
        "type": "info",
        "info": {
            "id": info.id, "name": info.name,
            "fps": info.fps, "duration_s": info.duration_s,
            "width": info.width, "height": info.height,
            "frame_count": info.frame_count,
        },
    })

    # make sure model is loaded
    if not MODEL.is_loaded():
        MODEL.load()

    loop = asyncio.get_running_loop()

    try:
        while not control.closed:
            if control.seek_frame is not None:
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, control.seek_frame))
                control.seek_frame = None

            if not control.playing:
                await asyncio.sleep(0.05)
                continue

            frame_idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            t_ms = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            ok, frame_bgr = cap.read()
            if not ok:
                # loop
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                continue

            # decode + infer in a worker thread so we don't block the event loop
            def work():
                t0 = cv2.getTickCount()
                pil = _bgr_to_pil(frame_bgr)
                result = infer_image(pil, threshold=0.5)
                latency = (cv2.getTickCount() - t0) / cv2.getTickFrequency() * 1000.0

                frame_jpeg = _encode_jpeg(frame_bgr, quality=78, max_width=1280)
                heat_jpeg = _render_heatmap_image(
                    [(p[0], p[1]) for p in result.points],
                    result.image_size,
                )
                return result, frame_jpeg, heat_jpeg, latency

            result, frame_jpeg, heat_jpeg, latency_ms = await loop.run_in_executor(None, work)

            payload = {
                "type": "frame",
                "frame_idx": frame_idx,
                "t_ms": t_ms,
                "width": result.image_size[0],
                "height": result.image_size[1],
                "frame_jpeg_b64": _b64(frame_jpeg),
                "heatmap_jpeg_b64": _b64(heat_jpeg),
                "inference": {
                    "count": result.count,
                    "peak_xy": list(result.peak_xy),
                    "points": [{"x": p[0], "y": p[1], "confidence": p[2]} for p in result.points],
                    "latency_ms": latency_ms,
                },
            }
            await ws.send_json(payload)

            # pace by target fps (cap at inference latency floor)
            interval = max(1.0 / max(control.target_fps, 0.1), latency_ms / 1000.0)
            await asyncio.sleep(interval)
    finally:
        control.closed = True
        cap.release()
        reader_task.cancel()
        try:
            await ws.close()
        except Exception:
            pass
