# Crowd Counter

Desktop app for crowd counting, density mapping, and human-in-the-loop annotation. Built to produce training data for a P2PNet model that will run on an autonomous drone.

## Architecture

```
crowd-counter/
├── core/                       Shared Python package (model + inference + I/O)
│   ├── model/p2pnet.py         P2PNet architecture — VGG16-BN backbone, FPN decoder, anchor-based heads
│   ├── inference.py            ModelHolder (thread-safe lazy loader), infer_image(), density helpers
│   ├── fetcher.py              Collection download — archive (zip) or per-image manifest via httpx
│   ├── dataset.py              Annotation/Collection dataclasses, JSON persistence
│   └── paths.py                Platform-aware dirs via platformdirs (~/Library/Application Support/CrowdCounter/)
├── app/                        Tauri 2 desktop application
│   ├── src-tauri/              Rust shell — spawns `uv run python -m app.sidecar.server` on startup, kills on exit
│   ├── src/                    React 19 + TypeScript + Tailwind v4 + Konva
│   ├── sidecar/server.py       FastAPI sidecar (HTTP + WebSocket) on port 17893
│   ├── sidecar/registry.py     Loads app/data/collections.json
│   └── data/collections.json   Built-in collection manifests
└── drone/                      (planned) Headless inference for Jetson Orin Nano
```

Two programs share `core/`: the annotation desktop app and (planned) a headless drone runtime. Same model code, same inference path.

## Tech stack

- **Desktop shell**: Tauri 2 (Rust) — manages sidecar lifecycle, provides `sidecar_port` command
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4
- **Canvas**: Konva + react-konva for the annotation view
- **State**: Zustand — view mode, collection/image selection, refresh coordination
- **Backend sidecar**: Python 3.11, FastAPI, Uvicorn, WebSockets
- **ML**: PyTorch (MPS on macOS, CUDA on Linux, CPU fallback), P2PNet (~21M params)
- **Env**: `uv` for Python, npm for JS, Cargo for Rust

## Data flow

1. Tauri starts → Rust spawns sidecar from repo root
2. React gets port via Tauri invoke, talks to sidecar over HTTP/WS
3. Collections download to `~/Library/Application Support/CrowdCounter/collections/{id}/images/`
4. Annotations saved as per-image JSON in `collections/{id}/annotations/`
5. Inference runs in sidecar; client computes density heatmaps from point lists

## Key patterns

### Sidecar API (server.py)

All REST endpoints are synchronous FastAPI handlers. Long-running operations (download, auto-annotate) use WebSocket endpoints that stream JSON progress events. The model loads in a background thread on startup.

When model weights aren't available, inference endpoints return a random stub response (seeded by image content) so the UI remains functional during development.

### Annotation workflow

The annotation flow is model-assisted: auto-annotate runs batch inference on all images, saving predictions as unreviewed annotations. The user then reviews each image — correcting dots (click to add/remove, drag to move) — and approves. Three states: `○` no annotation, `◐` predicted (needs review), `●` reviewed.

### Frontend state

Minimal Zustand store (`state/selection.ts`): `collectionId`, `imageName`, `expanded` set, `view` mode, `refreshKey` counter. No global annotation state — each view loads its own data from the API. `triggerRefresh()` increments `refreshKey` to signal `CollectionExplorer` to re-fetch image lists after mutations.

### Model weights

Loaded from `~/Library/Application Support/CrowdCounter/weights/`. Checks `p2pnet_finetuned.pth` first (fine-tuned), then `SHTechA.pth` (base pretrain). ~82 MB. The `ModelHolder` class in `core/inference.py` is thread-safe with a lock.

## Runtime data layout

```
~/Library/Application Support/CrowdCounter/
├── weights/
│   ├── SHTechA.pth                  Official pretrained weights
│   └── p2pnet_finetuned.pth         Fine-tuned weights (preferred if exists)
└── collections/
    └── {collection-id}/
        ├── images/                  Downloaded images (.jpg/.png/.webp)
        └── annotations/            Per-image JSON annotations
```

## Running the app

```bash
uv sync                              # Python deps
cd app && npm install && cd ..        # JS deps
cd app && npm run tauri dev           # Launch (compiles Rust on first run)
```

Weights must be manually placed — see README for curl command.

## Code conventions

- Python: type hints everywhere, `from __future__ import annotations`, dataclasses over dicts
- TypeScript: strict mode, no `any`, functional components, hooks for side effects
- CSS: Tailwind utility classes + CSS custom properties in `index.css` for the dark theme palette
- UI: monospace typography (JetBrains Mono), dark theme, military/tactical aesthetic with cyan accent (#00e5ff)
- No `__init__.py` files for app/sidecar — runs as namespace package from repo root via `python -m app.sidecar.server`

## Important implementation details

- P2PNet input must have both dimensions as multiples of 128 (see `_resize_for_inference`)
- The model's conv3/conv4 layers in regression/classification heads are dead weights (present in checkpoint but unused in forward pass) — this matches the official implementation
- Annotations carry `region` and `density` tags from their parent collection for future training-time filtering
- Confidence slider in the Inspector is display-only — it filters points client-side but doesn't affect the inference threshold (always 0.5)
- Save persists only filtered points (those above the confidence slider), so lowering the slider and saving permanently drops low-confidence detections
- Client density heatmap uses sigma=12, server uses sigma=8 — slight peak position differences between views
- StrictMode is disabled in main.tsx to avoid double-mount polling issues

## Known gaps / incomplete features

- No training/fine-tuning code or endpoint
- No HuggingFace auto-download of weights (README claims it, code doesn't do it)
- Regional collections have empty manifests (no Unsplash seeding yet)
- No video import (.mp4 → frames)
- No ONNX export for Jetson
- drone/ directory doesn't exist yet
- No tests, no CI
- `react-router-dom` is installed but unused
- Tauri bundle icons referenced in tauri.conf.json don't exist in repo
- `index.html` title is still "app-ui"
