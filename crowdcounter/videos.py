"""Video registry + per-frame detection / tracking stream."""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from crowdcounter.core.clustering import cluster_centroid
from crowdcounter.core.detector import DETECTOR, Detection
from crowdcounter.core.paths import app_data_root
from crowdcounter.world.projection import pixel_to_ground
from crowdcounter.world.telemetry import CameraIntrinsics, Telemetry

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"}

# Stock-footage default — most aerial cinema lenses are ~55-70° vertical FOV.
DEFAULT_VFOV_DEG = 60.0
# How far from a click (in image pixels) still counts as "you meant this track".
CLICK_TOLERANCE_PX = 80


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
            id=path.stem, name=path.stem, path=str(path),
            duration_s=duration, fps=fps, width=w, height=h,
            frame_count=frame_count, size_bytes=path.stat().st_size,
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


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


# ---------- streaming ----------

@dataclass
class StreamControl:
    playing: bool = True
    target_fps: float = 2.0
    seek_frame: int | None = None
    closed: bool = False
    alt_m: float = 30.0
    pitch_deg: float = -90.0  # -90 = nadir, 0 = horizontal
    vfov_deg: float = DEFAULT_VFOV_DEG
    selected_track_id: int | None = None
    pending_click: tuple[float, float] | None = None  # (x, y) in image px


def _build_telemetry(control: StreamControl, width: int, height: int) -> Telemetry:
    return Telemetry(
        alt_m=control.alt_m,
        pitch_deg=control.pitch_deg,
        roll_deg=0.0,
        yaw_deg=0.0,
        intrinsics=CameraIntrinsics.from_vfov(control.vfov_deg, width, height),
        source="manual",
        confidence=1.0,
    )


def _project(px: float, py: float, telem: Telemetry) -> dict | None:
    wp = pixel_to_ground(px, py, telem)
    if wp is None:
        return None
    return {
        "x_m": wp.x_m, "y_m": wp.y_m,
        "range_m": wp.range_m, "bearing_deg": wp.bearing_deg,
        "lat": wp.lat, "lon": wp.lon,
        "source": wp.source, "uncertainty_m": wp.uncertainty_m,
    }


def _resolve_click(dets: list[Detection], cx: float, cy: float) -> int | None:
    """Pick the nearest detection to a click point, within tolerance."""
    if not dets:
        return None
    best_id = None
    best_d2 = CLICK_TOLERANCE_PX * CLICK_TOLERANCE_PX
    for d in dets:
        dx, dy = d.cx - cx, d.cy - cy
        d2 = dx * dx + dy * dy
        if d2 < best_d2:
            best_d2 = d2
            best_id = d.track_id
    return best_id


async def stream_video(ws, video_id: str) -> None:
    """One WebSocket per playing video. Server is the timekeeper."""
    info = get_video(video_id)
    if info is None:
        await ws.send_json({"error": "video not found"})
        await ws.close()
        return

    control = StreamControl()
    centroid_trail: list[dict] = []   # normalized centroid history
    TRAIL_LEN = 80

    # Wipe ByteTrack so this stream starts fresh at id=1.
    DETECTOR.reset_tracker()

    async def reader():
        try:
            while not control.closed:
                msg = await ws.receive_json()
                action = msg.get("action")
                if action == "play":
                    control.playing = True
                elif action == "pause":
                    control.playing = False
                elif action == "seek":
                    control.seek_frame = int(msg.get("frame", 0))
                elif action == "fps":
                    control.target_fps = float(msg.get("fps", 2.0))
                elif action == "altitude":
                    control.alt_m = float(msg.get("alt_m", 30.0))
                elif action == "tilt":
                    # Clamp to (-90, 0] — past horizontal the ray won't hit the ground.
                    control.pitch_deg = max(-90.0, min(-0.5, float(msg.get("pitch_deg", -90.0))))
                elif action == "vfov":
                    control.vfov_deg = max(10.0, min(120.0, float(msg.get("vfov_deg", DEFAULT_VFOV_DEG))))
                elif action == "select_track":
                    control.pending_click = (float(msg.get("x", 0)), float(msg.get("y", 0)))
                elif action == "clear_selection":
                    control.selected_track_id = None
                    control.pending_click = None
        except Exception:
            control.closed = True

    reader_task = asyncio.create_task(reader())
    cap = cv2.VideoCapture(info.path)

    await ws.send_json({
        "type": "info",
        "info": {
            "id": info.id, "name": info.name,
            "fps": info.fps, "duration_s": info.duration_s,
            "width": info.width, "height": info.height,
            "frame_count": info.frame_count,
        },
    })

    if not DETECTOR.is_loaded():
        DETECTOR.load()

    loop = asyncio.get_running_loop()

    try:
        while not control.closed:
            if control.seek_frame is not None:
                cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, control.seek_frame))
                control.seek_frame = None
                # Tracker IDs no longer meaningful after a seek.
                DETECTOR.reset_tracker()
                control.selected_track_id = None

            if not control.playing:
                await asyncio.sleep(0.05)
                continue

            frame_idx = int(cap.get(cv2.CAP_PROP_POS_FRAMES))
            t_ms = float(cap.get(cv2.CAP_PROP_POS_MSEC))
            ok, frame_bgr = cap.read()
            if not ok:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                DETECTOR.reset_tracker()
                control.selected_track_id = None
                continue

            def work() -> tuple[list[Detection], bytes, float]:
                t0 = cv2.getTickCount()
                dets = DETECTOR.track(frame_bgr)
                latency = (cv2.getTickCount() - t0) / cv2.getTickFrequency() * 1000.0
                frame_jpeg = _encode_jpeg(frame_bgr, quality=78, max_width=1280)
                return dets, frame_jpeg, latency

            dets, frame_jpeg, latency_ms = await loop.run_in_executor(None, work)

            h, w = frame_bgr.shape[:2]

            # Resolve a pending click to a track id.
            if control.pending_click is not None:
                cx, cy = control.pending_click
                control.pending_click = None
                hit = _resolve_click(dets, cx, cy)
                if hit is not None:
                    control.selected_track_id = hit

            # Verify selected track still exists this frame.
            selected_det = None
            if control.selected_track_id is not None:
                for d in dets:
                    if d.track_id == control.selected_track_id:
                        selected_det = d
                        break

            # Dense-region centroid.
            cluster = cluster_centroid([(d.cx, d.cy) for d in dets], (w, h))

            # Update centroid trail.
            if cluster is not None:
                centroid_trail.append({
                    "nx": cluster.cx / max(w, 1),
                    "ny": cluster.cy / max(h, 1),
                    "t_ms": t_ms,
                    "frame_idx": frame_idx,
                    "count": len(dets),
                })
                if len(centroid_trail) > TRAIL_LEN:
                    centroid_trail.pop(0)

            # Build telemetry + world projections.
            telem = _build_telemetry(control, w, h)
            world_centroid = _project(cluster.cx, cluster.cy, telem) if cluster else None
            world_selected = _project(selected_det.cx, selected_det.cy, telem) if selected_det else None

            payload = {
                "type": "frame",
                "frame_idx": frame_idx,
                "t_ms": t_ms,
                "width": w,
                "height": h,
                "frame_jpeg_b64": _b64(frame_jpeg),
                "latency_ms": latency_ms,
                "detections": [
                    {
                        "id": d.track_id,
                        "cx": d.cx, "cy": d.cy,
                        "bbox": list(d.bbox),
                        "conf": d.conf,
                    } for d in dets
                ],
                "count": len(dets),
                "cluster": (
                    {
                        "cx": cluster.cx, "cy": cluster.cy,
                        "radius_px": cluster.radius_px,
                        "member_count": cluster.member_count,
                    } if cluster else None
                ),
                "selected": (
                    {
                        "id": selected_det.track_id,
                        "cx": selected_det.cx, "cy": selected_det.cy,
                        "bbox": list(selected_det.bbox),
                    } if selected_det else None
                ),
                "centroid_trail": centroid_trail.copy(),
                "pose": {
                    "pitch_deg": control.pitch_deg,
                    "roll_deg": 0.0,
                    "yaw_deg": 0.0,
                    "alt_m": control.alt_m,
                    "vfov_deg": control.vfov_deg,
                    "source": "manual",
                    "confidence": 1.0,
                },
                "world_centroid": world_centroid,
                "world_selected": world_selected,
            }
            await ws.send_json(payload)

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
