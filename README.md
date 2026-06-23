# Crowd Counter

Real-time aerial crowd tracker. Detects every person in frame, surfaces the densest cluster, and lets you click a person to follow them across frames — with their position projected to ground coordinates in meters.

The desktop app is a research / debugger UI for an inference pipeline that will eventually run headless on a drone (Jetson Orin Nano). For now it tests on stock aerial footage, with sliders for the altitude / camera tilt the drone telemetry will provide later.

## Demo loop

1. Drop a `.mp4` into `~/Library/Application Support/CrowdCounter/videos/`.
2. `./run.sh` — Vite + Python sidecar + window come up together.
3. Pick the clip, press play. Per-person dots appear, a halo marks the dense region.
4. **Click a person** → ByteTrack locks onto that ID, the inspector starts streaming their world coordinates.
5. Drag the altitude / tilt sliders to match the camera's apparent geometry — the world coords reproject live.

## Stack

| Layer       | Tech                                                                 |
|-------------|----------------------------------------------------------------------|
| Frontend    | Svelte 5 (runes), TypeScript, Vite, Tailwind v4                      |
| Window      | `pywebview` 6 — wraps localhost in a native window, ~50 lines        |
| Backend     | Python 3.11, FastAPI, Uvicorn. `uv` for deps.                        |
| Detector    | YOLO11x + ByteTrack (Ultralytics) — person class only, persistent IDs |
| Projection  | Pinhole + ray/ground-plane intersection (manual altitude + tilt)     |
| Compute     | PyTorch with MPS (Mac), CUDA (Jetson, future), CPU fallback          |

The Python process owns everything: FastAPI on `:17893` serves `/api/*` and the built Svelte bundle, and the same process opens the window. No Rust, no Electron, no subprocess split.

## Architecture

```
crowd-counter/
├── crowdcounter/                  Python — backend + entrypoint
│   ├── __main__.py                python -m crowdcounter
│   ├── server.py                  FastAPI: /api/health, /api/infer, /api/videos, WS /api/video/{id}/stream
│   ├── videos.py                  per-video WebSocket loop: decode → detect → cluster → project → push
│   ├── core/
│   │   ├── detector.py            YOLO11 + ByteTrack (DetectorHolder, persistent tracker state)
│   │   ├── clustering.py          dense-region centroid (grid-bin + radius filter)
│   │   └── paths.py               ~/Library/Application Support/CrowdCounter/
│   └── world/
│       ├── projection.py          pixel → ground plane
│       └── telemetry.py           Telemetry / CameraIntrinsics / WorldPoint
└── web/                           Svelte 5 + TS + Tailwind v4
    └── src/lib/
        ├── live/                  LiveView, VideoCanvas, Inspector, TrackMap, Timeline, SourceList
        ├── stores/stream.svelte.ts
        └── types.ts
```

## Data flow

```
mp4 file
   ↓ cv2.VideoCapture (decode in executor thread)
frame (BGR ndarray)
   ↓ DETECTOR.track(persist=True)
detections[]  ─── ByteTrack assigns persistent IDs
   ↓
cluster_centroid()  →  dense-region halo
   ↓
pixel_to_ground(centroid)        →  world_centroid    (x_m, y_m)
pixel_to_ground(selected.center) →  world_selected   (x_m, y_m)
   ↓
WebSocket push (frame jpeg + detections + cluster + selected + pose + world coords)
   ↓
Svelte renders dots / halo / lock-on, slider edits reproject live
```

## Running

```bash
git clone https://github.com/ethanalcohen/crowd-counter.git
cd crowd-counter

./run.sh                  # dev mode  (Vite HMR + Python sidecar + window)
./run.sh build            # production mode (built bundle, served from Python)
./run.sh headless         # API only, no window
```

Prereqs: `uv`, Node 22+, npm. macOS is the dev target (Apple Silicon MPS); CUDA Linux works for the backend.

First boot pulls a few hundred MB of Python wheels (torch, ultralytics) and auto-downloads `yolo11x.pt` (~110 MB) into `~/Library/Application Support/CrowdCounter/weights/`. Subsequent boots are cold-to-window in a few seconds.

## On-disk layout

```
~/Library/Application Support/CrowdCounter/
├── videos/                        drop .mp4/.mov/.mkv/.webm here
└── weights/
    └── yolo11x.pt                 auto-downloaded
```

## What's not here

Deferred to other branches / sessions:

- **Annotation + fine-tuning** — out of scope; pretrained YOLO is good enough to validate the pipeline.
- **Real drone telemetry** — projection consumes a `Telemetry` struct, which currently comes from sliders. Wiring MAVLink / DJI SDK is a swap, not a rewrite.
- **PerspectiveFields auto-pose** — module is on disk but unwired. Manual sliders proved more reliable on stock footage than estimating roll/pitch/FOV from a single frame.
- **Multi-camera / swarm**, **Jetson port**, **ReID-based occlusion recovery** — explicitly deferred.
- **v1 (Tauri + React + P2PNet density estimation)** lives on the `v1-react` branch for reference.

## Documentation

Engineering log of what shipped and why: [LOG.md](LOG.md). Update it whenever you ship a non-trivial change — it's the portfolio narrative.

## Credits

- **YOLO11** — Ultralytics ([github.com/ultralytics/ultralytics](https://github.com/ultralytics/ultralytics)).
- **ByteTrack** — Zhang et al., *"ByteTrack: Multi-Object Tracking by Associating Every Detection Box"*, ECCV 2022.
- **PerspectiveFields** (kept on disk as future fallback) — Jin et al., CVPR 2023.
