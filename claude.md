# Crowd Counter v2

A research/visualization tool for a real-time aerial crowd-density tracker that will eventually run headless on a drone (Jetson Orin Nano). The desktop GUI is a debugger / live view for that headless inference path.

**Scope of this codebase: live view only.** Annotation, fine-tuning, Jetson deployment, and 3D / multi-camera / swarm work are deferred to separate sessions and are *not* present.

The v1 build (Tauri + React + Rust + Python) lives on the `v1-react` branch for reference.

## Architecture

```
crowd-counter/
├── crowdcounter/                    Python package — backend + entrypoint
│   ├── __main__.py                  python -m crowdcounter (boots FastAPI + pywebview window)
│   ├── server.py                    FastAPI app — /api/health, /api/infer
│   └── core/                        model + inference (kept from v1)
│       ├── model/p2pnet.py          P2PNet — VGG16-BN backbone, FPN decoder, anchor-based heads
│       ├── inference.py             ModelHolder (thread-safe lazy loader), infer_image()
│       ├── fetcher.py               (kept; not yet wired to v2 video registry)
│       ├── dataset.py               (kept; not yet used in v2)
│       └── paths.py                 ~/Library/Application Support/CrowdCounter/
└── web/                             Svelte 5 + TS + Tailwind v4 frontend
    ├── src/App.svelte               (Phase 0 stub — health pill only)
    └── vite.config.ts               proxies /api → :17893
```

The Python package and the web frontend are deployed together: `crowdcounter.server.py` serves `web/dist/` as static files in production, and proxies to the Vite dev server (`--dev` flag) during development.

## Stack

- **Backend**: Python 3.11, FastAPI, Uvicorn. `uv` for deps.
- **Frontend**: Svelte 5 (runes), TypeScript, Vite, Tailwind v4.
- **Window**: `pywebview` 6 — ~50 lines to wrap localhost in a native window. No Rust, no Tauri.
- **ML**: PyTorch 2.12 with MPS (Mac) / CUDA (Jetson, future) / CPU fallback. P2PNet ~21M params, ~600ms/frame on Apple Silicon.
- **Pose estimation (planned, Phase 3)**: PerspectiveFields (CVPR 2023) for synthesizing camera orientation from stock footage when real telemetry isn't available.

## Running

```bash
uv sync                                # Python deps
cd web && npm install && cd ..         # JS deps

# Dev (Vite HMR + Python sidecar + pywebview window):
cd web && npm run dev &                # vite on :5173
uv run python -m crowdcounter --dev    # FastAPI on :17893 + window pointed at vite

# Production (single command, served from built static dist):
cd web && npm run build && cd ..
uv run python -m crowdcounter

# Headless (no window, just the API):
uv run python -m crowdcounter --no-window
```

The model autoloads in a background thread on server startup; the `/api/health` pill flips from amber → cyan when ready (~5s).

## Data flow

1. `python -m crowdcounter` boots FastAPI in a thread, then opens a pywebview window.
2. Svelte app talks to FastAPI exclusively over `/api/*` (proxied through Vite in dev).
3. Inference: client posts image bytes to `/api/infer` → server runs P2PNet → returns `{points, peak_xy, count, image_size}`.
4. **(Coming in Phase 1)**: video streaming via WebSocket — backend decodes a video file frame-by-frame, runs inference, pushes `FrameAnalysis` JSON over WS.

## What lives where on disk

Same locations as v1:

```
~/Library/Application Support/CrowdCounter/
├── weights/
│   ├── SHTechA.pth                 official pretrain (~82 MB)
│   └── p2pnet_finetuned.pth        preferred if present (future, not in scope)
└── collections/
    └── {id}/images/                downloaded test data
```

`ModelHolder` checks `p2pnet_finetuned.pth` first, falls back to `SHTechA.pth`.

## Phase plan (from /Users/ethanalcohen/.claude/plans/ok-so-i-want-crystalline-fairy.md)

- ✅ **Phase 0** — Cleanup + scaffold (this commit).
- **Phase 1** — Live view v2: video import, per-frame inference over WS, Gaia-style overlays.
- **Phase 2** — Densest-point trail on the live view.
- **Phase 3** — Pixel → world coordinates (telemetry-driven + PerspectiveFields fallback).
- **Phase 4** — Multi-frame Kalman tracking of the peak.
- **Phase 5** — Stock footage library (Pexels CC0, VisDrone-CC, PETS2009).

Out of scope this codebase: annotation UI, fine-tuning loop, Jetson port, 3D / multi-camera.

## Conventions

- Python: type hints everywhere, `from __future__ import annotations`, dataclasses over dicts.
- TypeScript: strict, no `any`. Svelte 5 runes (`$state`, `$derived`, `$effect`).
- Styling: Tailwind utility classes. Dark theme baseline. Cyan accent for live data, amber for pending, red for errors. Mono fonts (JetBrains Mono / system mono) for all telemetry numbers.
- API: all backend routes live under `/api/*`. The root `/` serves the built Svelte app.
- Sidecar lifecycle: the Python process owns the FastAPI + window. No subprocess split, no Rust shell.

## Important implementation details

- P2PNet input must have both dims as multiples of 128 (see `_resize_for_inference`).
- The model's conv3/conv4 in regression/classification heads are dead weights — present in checkpoint, unused in forward. Matches the official Tencent implementation.
- Vite dev binds to IPv6 `localhost:5173` only (not 127.0.0.1) — use `localhost` not the IP for curl tests.

## What's deferred / not built yet

- Video import + per-frame WS stream (Phase 1, next).
- World coordinate projection (Phase 3).
- Stock footage library / video registry (Phase 5).
- Tests, CI.
- Production app bundling (PyInstaller).
