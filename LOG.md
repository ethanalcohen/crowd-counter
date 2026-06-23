# Build Log

Chronological record of what shipped, what changed, and *why*. Newest entries on top.

---

## 2026-06-23 — Fix: switching sources crashed the stream

**Bug**: clicking a second source in the left rail killed the WebSocket on the very first frame with `TypeError: 'NoneType' object is not subscriptable` from Ultralytics' post-predict callback.

**Cause**: [`detector.reset_tracker()`](crowdcounter/core/detector.py) was setting `predictor.trackers = None`, but the `on_predict_postprocess_end` callback in Ultralytics always indexes `predictor.trackers[0]`. Setting to None / [] both crash.

**Fix**: `delattr(predictor, "trackers")` instead — Ultralytics' `register_tracker()` rebuilds the list on the next call when the attribute is absent.

**Verified**: streamed three sources in sequence (`favela-market → istanbul-spice-bazaar → favela-market`); each opens cleanly with track IDs starting from 1.

---

## 2026-06-23 — Docs, run script, push discipline

- Added [`run.sh`](run.sh) — one-command launcher (`dev` / `build` / `headless`). Handles `uv sync` and `npm install` on first run, traps SIGINT to kill Vite when the Python process exits.
- Rewrote [README.md](README.md) — the prior version still described the v1 Tauri/React/P2PNet build.
- Updated [CLAUDE.md](CLAUDE.md) with current architecture and a **Documentation discipline** section: append to LOG.md on non-trivial changes, keep README/CLAUDE.md in sync, and **commit + push to `origin/main`** after each non-trivial change.

---

## 2026-06-23 — Pivot from density estimation to per-person detection + tracking

### Why

P2PNet (density estimation) was the wrong primitive. It underperformed on sparse / oblique-angle crowds — exactly the shots the eventual drone payload will fly — and its single "peak density point" output couldn't support the real product idea: **click on a person, watch the system track that person**.

### What changed

**Model swap**
- Out: P2PNet (~21M params, density heads, ICCV 2021).
- In: YOLO11x + ByteTrack (Ultralytics). Per-person detection with persistent track IDs out of the box.
- Same MPS / CUDA / CPU fallback path. Weights auto-download to `~/Library/Application Support/CrowdCounter/weights/yolo11x.pt` on first boot (~110 MB).

**New backend modules**
- [`crowdcounter/core/detector.py`](crowdcounter/core/detector.py) — `DetectorHolder`: thread-safe lazy loader. One global model with a per-stream `reset_tracker()` so ByteTrack IDs don't bleed between sessions or after seeks.
- [`crowdcounter/core/clustering.py`](crowdcounter/core/clustering.py) — `cluster_centroid()`: grid-bin → radius-filter. Outputs a stable "dense region" centroid + member count + spread radius. Deliberately not argmax — it's too jumpy frame-to-frame.

**Rewritten**
- [`crowdcounter/videos.py`](crowdcounter/videos.py) — WebSocket loop now streams `detections[]` with track IDs, the centroid, the selected track, and world projections for both. Handles `select_track {x, y}`, `clear_selection`, `tilt`, `vfov`, plus the existing `play / pause / seek / fps / altitude`.
- [`crowdcounter/server.py`](crowdcounter/server.py) — `MODEL → DETECTOR`. `/api/infer` returns detections instead of density points.

**Projection (kept, rewired)**
- [`crowdcounter/world/projection.py`](crowdcounter/world/projection.py) math is unchanged — pinhole + ray-plane intersection.
- Telemetry now comes from **two manual sliders** (altitude + tilt) plus a vFOV control, instead of PerspectiveFields auto-estimation. Stock footage gives us no real telemetry, so eyeballing it beats trusting a NN on a frame it was never trained for.
- PerspectiveFields module is still on disk for an eventual real-drone fallback, but it's no longer wired into the per-frame loop.

**Frontend (Svelte 5 + Tailwind v4)**
- [`web/src/lib/types.ts`](web/src/lib/types.ts) — new `FrameAnalysis` schema: `detections`, `cluster`, `selected`, `centroid_trail`, `world_centroid`, `world_selected`.
- [`web/src/lib/stores/stream.svelte.ts`](web/src/lib/stores/stream.svelte.ts) — new control senders: `setTilt`, `setVfov`, `selectTrack`, `clearSelection`.
- [`web/src/lib/live/VideoCanvas.svelte`](web/src/lib/live/VideoCanvas.svelte) — per-person rings, dense-region halo with member count, selected-track lock-on label, click-on-canvas to select.
- [`web/src/lib/live/Inspector.svelte`](web/src/lib/live/Inspector.svelte) — SELECTED TRACK section with live world coords, DENSE REGION ground section, altitude + tilt + vFOV sliders. PerspectiveFields confidence row removed.
- [`web/src/lib/live/TrackMap.svelte`](web/src/lib/live/TrackMap.svelte) — repointed at `centroid_trail`; same visual, new semantics.

**Deleted**
- `crowdcounter/core/model/p2pnet.py`
- `crowdcounter/core/inference.py`

### Verified

End-to-end smoke test on `favela-market.mp4` (3840×2160):

| metric                  | value                                                              |
|------------------------|---------------------------------------------------------------------|
| detections per frame    | 7 (stable)                                                          |
| ID persistence          | yes — track #1 stayed #1 across frames after click                  |
| latency (cold / warm)   | 1380 ms / ~140 ms on MPS                                            |
| world projection sanity | 40 m alt + −60° tilt → ~43 m range, ~16 m forward — geometrically right |
| svelte-check            | 0 errors                                                            |

---

## 2026-06-22 — Tactical UI overhaul + color system

Replaced the early blue-accented palette with a Palantir/Anduril-inspired scheme: warm near-black background, amber primary, red for critical, white-dim for data. Mono fonts (JetBrains Mono) across all telemetry numbers. Tightened the right rail into discrete TRACK / WORLD / POSE / FEED sections with a peak trail mini-map.

---

## 2026-06-21 — Phase 3 v1: pixel → world projection

Added `crowdcounter/world/` with `Telemetry`, `CameraIntrinsics`, `WorldPoint`, and `pixel_to_ground()` (pinhole + ray/ground-plane intersection). Added PerspectiveFields wrapper for per-frame pose estimation from stock footage (CVPR 2023). The right rail started showing live `(x, y) meters / range / bearing` for the density peak.

*(Superseded 2026-06-23: PerspectiveFields no longer in the per-frame loop; the same projection now runs on slider-driven manual pose.)*

---

## 2026-06-20 — Phase 1: live video stream + per-frame inference

First video pipeline. `crowdcounter/videos.py` scans `~/Library/Application Support/CrowdCounter/videos/`, opens a per-video WebSocket, decodes frames with OpenCV, runs P2PNet in an executor, and pushes `frame + heatmap + count + peak_xy` over the wire. Frontend: `VideoCanvas` (frame + heatmap blend), `Timeline` (play/pause/seek/fps), `Inspector` (count, peak, FPS), `SourceList` (clip picker).

---

## 2026-06-19 — Phase 0: stack pivot

Migrated v1 (Tauri 2 + React + Rust shell) → v2 (pywebview + Svelte 5 + Python). The Rust shell was buying us nothing — pywebview wraps a localhost URL in a native window in ~50 lines and matches the production deployment story (one Python process serves the UI and the API). Svelte 5 runes replaced Zustand for state. Tailwind v4 stayed. The v1 build is parked on the `v1-react` branch.

---

## Architecture (current)

```
crowd-counter/
├── crowdcounter/                  Python — backend + entrypoint
│   ├── __main__.py                python -m crowdcounter (FastAPI + pywebview)
│   ├── server.py                  /api/health, /api/infer, /api/videos, /api/video/{id}/stream
│   ├── videos.py                  per-video WebSocket loop
│   ├── core/
│   │   ├── detector.py            YOLO11 + ByteTrack
│   │   ├── clustering.py          dense-region centroid
│   │   └── paths.py               ~/Library/Application Support/CrowdCounter/
│   └── world/
│       ├── projection.py          pixel → ground plane
│       ├── telemetry.py           Telemetry / CameraIntrinsics / WorldPoint
│       └── pose_estimator.py      PerspectiveFields wrapper (not wired in v2)
└── web/                           Svelte 5 + TS + Tailwind v4
    └── src/lib/
        ├── live/                  LiveView, VideoCanvas, Inspector, TrackMap, Timeline, SourceList
        ├── stores/stream.svelte.ts
        └── types.ts
```
