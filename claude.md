# Crowd Counter v2

A research/visualization tool for a real-time aerial crowd tracker that will eventually run headless on a drone (Jetson Orin Nano). The desktop GUI is a debugger / live view for that headless inference path.

**Scope of this codebase: live view only.** Annotation, fine-tuning, Jetson deployment, and 3D / multi-camera / swarm work are deferred to separate sessions and are *not* present.

The v1 build (Tauri + React + Rust + P2PNet density estimation) lives on the `v1-react` branch for reference.

## Documentation discipline

This is a portfolio project. Keep the narrative coherent — code-only changes leave no story.

- **After any non-trivial change** (new feature, model swap, architectural pivot, removed surface), append a dated entry to [LOG.md](LOG.md). Newest entry on top. Cover *why*, *what changed*, and *what was verified*. Reference modified files as markdown links.
- **If a change makes the README inaccurate** (stack swap, new dependency, new run command, removed feature), edit `README.md` in the same change. Don't leave it stale.
- **If a change makes this CLAUDE.md inaccurate** (architecture map below, phase plan, conventions), update it too.
- Trivial fixes (typos, comment tweaks, single-line bugfixes) don't need a log entry.
- When in doubt: write the entry. A log with a few too-small entries is fine; a gap of weeks is not.
- **After finishing any non-trivial change, commit and push to `origin/main`.** Same threshold as the log entry: if it earned a LOG.md entry, it should land on the remote in the same session. Use a descriptive commit message (the LOG.md headline is a good starting point). Don't bundle unrelated changes into one commit. Never force-push to `main`.

## Architecture

```
crowd-counter/
├── crowdcounter/                    Python package — backend + entrypoint
│   ├── __main__.py                  python -m crowdcounter (boots FastAPI + pywebview window)
│   ├── server.py                    FastAPI — /api/health, /api/infer, /api/videos, WS /api/video/{id}/stream
│   ├── videos.py                    per-video WebSocket loop (decode → detect → cluster → project → push)
│   ├── core/
│   │   ├── detector.py              DetectorHolder — YOLO11 + ByteTrack, persistent per-stream IDs
│   │   ├── clustering.py            cluster_centroid() — dense-region centroid (grid-bin + radius)
│   │   ├── fetcher.py               (kept from v1; not wired)
│   │   ├── dataset.py               (kept from v1; not wired)
│   │   └── paths.py                 ~/Library/Application Support/CrowdCounter/
│   └── world/
│       ├── projection.py            pixel_to_ground() — pinhole + ray/ground intersection
│       ├── telemetry.py             Telemetry / CameraIntrinsics / WorldPoint
│       └── pose_estimator.py        PerspectiveFields wrapper (on disk, not wired in v2)
└── web/                             Svelte 5 + TS + Tailwind v4 frontend
    └── src/lib/
        ├── live/                    LiveView, VideoCanvas, Inspector, TrackMap, Timeline, SourceList
        ├── stores/stream.svelte.ts  StreamStore — WS client + control senders
        └── types.ts                 FrameAnalysis schema
```

The Python package and the web frontend are deployed together: `crowdcounter.server.py` serves `web/dist/` as static files in production, and the Vite dev server (`--dev` flag) runs on :5173 during development. There is no Rust shell, no subprocess split — one Python process owns everything.

## Stack

- **Backend**: Python 3.11, FastAPI, Uvicorn. `uv` for deps.
- **Frontend**: Svelte 5 (runes), TypeScript, Vite, Tailwind v4.
- **Window**: `pywebview` 6 — ~50 lines to wrap localhost in a native window. No Rust, no Tauri.
- **ML**: PyTorch 2.12 with MPS (Mac) / CUDA (Jetson, future) / CPU fallback. YOLO11x + ByteTrack via Ultralytics; ~140 ms/frame warm on Apple Silicon MPS.
- **Pose**: manual altitude + tilt + vFOV sliders (stock-footage workflow). PerspectiveFields module is on disk but unwired — kept as a real-drone fallback path.

## Running

```bash
./run.sh                  # dev: Vite HMR + Python sidecar + pywebview window
./run.sh build            # production: build the Svelte bundle, serve from Python
./run.sh headless         # API only, no window (curl-friendly)
```

The script handles `uv sync` and `npm install` on first run. The detector autoloads in a background thread on server startup; `/api/health` flips `model_loaded: true` when ready (cold first call downloads `yolo11x.pt` ~110 MB; subsequent boots are ~5s).

## Data flow

1. `python -m crowdcounter` boots FastAPI in a thread, then opens a pywebview window.
2. Svelte app talks to FastAPI exclusively over `/api/*` (proxied through Vite in dev).
3. Single-image: client posts to `/api/infer` → YOLO11 + ByteTrack (tracker reset per call) → returns `{detections, cluster_xy, count, image_size}`.
4. Video streaming (the primary path): `WS /api/video/{id}/stream`. Backend decodes frames with OpenCV in an executor thread, runs `DETECTOR.track(persist=True)`, computes the dense-region centroid, resolves any pending click → `selected_track_id`, projects centroid + selected to ground using current slider state, pushes `FrameAnalysis` JSON. Client controls (`play / pause / seek / fps / altitude / tilt / vfov / select_track / clear_selection`) flow back over the same socket.

## What lives where on disk

```
~/Library/Application Support/CrowdCounter/
├── videos/                         drop .mp4/.mov/.mkv/.webm here — SourceList picks them up
├── weights/
│   └── yolo11x.pt                  auto-downloaded by Ultralytics on first load (~110 MB)
└── collections/                    (v1 artifact; unused in v2)
```

## Phase plan

- ✅ **Phase 0** — Stack pivot to pywebview + Svelte.
- ✅ **Phase 1** — Live video stream + per-frame inference over WebSocket.
- ✅ **Phase 2** — Trail mini-map.
- ✅ **Phase 3** — Pixel → world coordinates.
- ✅ **Phase 3.5** *(2026-06-23)* — Pivoted from P2PNet (density) to YOLO11 + ByteTrack (per-person detection with persistent IDs). Click-to-track. Slider-driven projection (altitude + tilt + vFOV) instead of PerspectiveFields. See [LOG.md](LOG.md).
- **Next** — Multi-frame Kalman smoothing of the centroid + selected track. ReID for occlusion recovery. Stock footage library (Pexels CC0, VisDrone, PETS2009).

Out of scope this codebase: annotation UI, fine-tuning loop, Jetson port, 3D / multi-camera.

## Conventions

- Python: type hints everywhere, `from __future__ import annotations`, dataclasses over dicts.
- TypeScript: strict, no `any`. Svelte 5 runes (`$state`, `$derived`, `$effect`).
- Styling: Tailwind utility classes. Dark theme baseline. Amber primary, red critical, white-dim for data, warm near-black background. Mono fonts (JetBrains Mono / system mono) for all telemetry numbers.
- API: all backend routes live under `/api/*`. The root `/` serves the built Svelte app.
- Sidecar lifecycle: the Python process owns the FastAPI + window. No subprocess split, no Rust shell.

## Important implementation details

- **ByteTrack state is global to the detector.** `DETECTOR.reset_tracker()` is called on stream open, on seek, and on video loop. Concurrent video streams would clobber each other — single-stream is the intended pattern.
- **Tilt is clamped to `(-90°, -0.5°]`.** At horizon or above, the camera ray never intersects the ground plane and projection returns None.
- **vFOV defaults to 60°** — most aerial cinema lenses sit in 55–70°. There's no exif metadata in stock clips, so this is eyeballed.
- **Frame JPEG max-width is 1280 px** for transport (`_encode_jpeg`); detection / cluster coordinates remain in source resolution.
- Vite dev binds to IPv6 `localhost:5173` only (not 127.0.0.1) — use `localhost` not the IP for curl tests.

## What's deferred / not built yet

- ReID for re-acquisition after occlusion (ByteTrack drops the ID; user re-clicks).
- Kalman smoothing of the centroid + selected track.
- Stock footage library / video registry beyond "drop a file in this folder".
- Real drone telemetry ingest (MAVLink / DJI SDK) — `Telemetry` struct is ready; ingest is not.
- Tests, CI.
- Production app bundling (PyInstaller).
