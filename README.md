# Crowd Counter

A desktop app for crowd counting, density mapping, and annotation — built to feed a future autonomous drone.

Given a photo or video, it estimates the number of people in frame, draws a density heatmap, and returns the **(x, y) pixel coordinate of the densest point**. It also runs a live-feed view that simulates a drone stream over a folder of images. The annotation workflow lets you correct model predictions dot-by-dot, and those corrections become training data for fine-tuning the model on your specific deployment scenarios.

## Architecture

```
crowd-counter/
├── core/                       shared Python package — model + inference + I/O
│   ├── model/p2pnet.py         P2PNet architecture (matches official state_dict)
│   ├── inference.py            infer_image() — preprocess → forward → post-process
│   ├── fetcher.py              collection download (per-image + archive modes)
│   ├── dataset.py              annotation format, Collection schema
│   └── paths.py                platform-aware app data dirs
├── app/                        Tauri desktop application
│   ├── src-tauri/              Rust shell — launches + supervises the sidecar
│   ├── src/                    React + TypeScript UI
│   ├── sidecar/server.py       FastAPI sidecar — HTTP + WebSocket
│   └── data/collections.json   built-in collection registry
└── drone/                      (planned) headless inference for the Jetson
```

Two programs share one model:

1. **Annotation app** — the desktop UI. Used for inference review, dot correction, dataset export.
2. **Drone runtime** *(planned)* — headless Python script. Same `core/` package, no UI. Ports to NVIDIA Jetson Orin Nano via ONNX → TensorRT.

The split exists so the inference path is identical between dev machine and drone: change once, runs the same everywhere.

## Stack

- **Frontend**: Tauri 2 (Rust shell) + React 19 + TypeScript + Tailwind v4. Konva for the annotation canvas, Zustand for state.
- **Backend (sidecar)**: Python 3.11 + FastAPI + PyTorch 2.12 (MPS on macOS, CUDA on Linux, CPU fallback).
- **Model**: P2PNet (ICCV 2021), VGG16-BN backbone, point-based crowd counter, ~21M params. Pretrained weights from the official Tencent release.
- **Env management**: uv for Python, npm for JS, cargo for Rust.

## What works today

- **Library sidebar**: file-explorer-style tree of collections, grouped into a fine-tuning base (academic datasets) and regional collections (North America / Middle East / East Asia × urban / rural).
- **Download**: per-collection pull. Academic collections fetch via direct archive URL; regional collections fetch image-by-image from a manifest. Both stream progress over WebSocket and persist to `~/Library/Application Support/CrowdCounter/collections/`.
- **Annotate view**:
  - Click an image → Konva canvas, fit-to-view, scroll-zoom, space-drag pan.
  - **Run Inference** → real P2PNet (~600ms on Apple Silicon MPS).
  - Click empty area to add a dot, click a dot to remove, drag to move.
  - Live density-map overlay, peak crosshair, count + (x, y) readout.
  - `⌘Z` undo, 50-step history. Min-confidence slider filters model-predicted points.
  - `Save` writes a per-image JSON annotation; `Mark Reviewed` flags it as training-ready.
- **Live view**:
  - Pick a downloaded collection → app cycles through its images at a configurable interval.
  - Per-frame: real model inference, heatmap overlay, cyan target crosshair on peak, HUD (source / frame / file / count / peak xy / latency / fps).
  - Target History mini-map plots normalized peak positions across the last 80 frames.
- **Status pill**: top-right of the topbar. `P2PNET · MPS` when model loaded, `MODEL · UNLOADED` while autoloading, `SIDECAR · ERROR` if the Python process dies.

## Built-in collections

| Kind        | ID                | Source                                  | Size      | Status     |
|-------------|-------------------|------------------------------------------|-----------|------------|
| Academic    | shanghaitech-a    | HuggingFace mirror                       | ~290 MB   | not verified |
| Academic    | shanghaitech-b    | HuggingFace mirror                       | ~330 MB   | not verified |
| Academic    | ucf-qnrf          | crcv.ucf.edu                             | ~4.5 GB   | canonical URL, untested at scale |
| Academic    | nwpu-crowd        | gated — manual access required           | ~5 GB     | manifest URL is `null` |
| Regional    | na-urban          | Unsplash (manifest TBD)                  | —         | empty manifest |
| Regional    | na-rural          | Unsplash (manifest TBD)                  | —         | empty manifest |
| Regional    | me-urban          | Unsplash (manifest TBD)                  | —         | empty manifest |
| Regional    | me-rural          | Unsplash (manifest TBD)                  | —         | empty manifest |
| Regional    | ea-urban          | Unsplash (manifest TBD)                  | —         | empty manifest |
| Regional    | ea-rural          | Unsplash (manifest TBD)                  | —         | empty manifest |

Regional collections are placeholders — their image manifests need to be seeded from Unsplash (or similar) before they're useful. Each annotation carries its region/density tag so fine-tuning can filter/weight by them later.

## Model weights

P2PNet weights are auto-loaded from the first existing file in:

1. `~/Library/Application Support/CrowdCounter/weights/p2pnet_finetuned.pth` (fine-tuned, preferred)
2. `~/Library/Application Support/CrowdCounter/weights/SHTechA.pth` (official ShanghaiTech Part A pretrain)

The base weights are fetched on first run from `huggingface.co/spaces/amirDev/crowd-counting-p2p` (~82 MB). If that mirror disappears, drop a compatible checkpoint into the path above and the sidecar will pick it up on next reload.

## Setup

### Prerequisites

- macOS 12+ (Apple Silicon for MPS) — Linux/Windows should work but haven't been tested.
- Node 22+ and npm
- Rust toolchain (`rustup`)
- Python 3.11 (managed by `uv`)
- `uv` (`brew install uv`)

### Install

```bash
git clone https://github.com/ethanalcohen/crowd-counter.git
cd crowd-counter

# Python deps (creates .venv, installs torch + fastapi + ...)
uv sync

# JS deps
cd app && npm install && cd ..
```

### Pre-download model weights *(recommended)*

```bash
mkdir -p ~/Library/Application\ Support/CrowdCounter/weights
curl -L -o ~/Library/Application\ Support/CrowdCounter/weights/SHTechA.pth \
  "https://huggingface.co/spaces/amirDev/crowd-counting-p2p/resolve/main/SHTechA.pth"
```

The sidecar will lazy-load on first inference if missing, but the first call takes ~4s while the model loads.

### Run

```bash
cd app
npm run tauri dev
```

First launch compiles the Rust shell (3–5 min on a clean checkout). Subsequent launches are seconds.

## Roadmap

Near-term:
- [ ] **Retrain button** — fine-tune P2PNet on reviewed annotations, save to `p2pnet_finetuned.pth`, hot-swap on next inference. Wire as an in-app button + sidecar endpoint with WebSocket progress.
- [ ] **Unsplash seeding** — populate the six regional collection manifests with ~50 images each.
- [ ] **Video import** — drag-drop a `.mp4`, extract frames at a configurable rate, drop into a `My Imports` user collection.
- [ ] **Export to ShanghaiTech `.mat`** — write `image_labels.mat` for compat with public training pipelines.

Longer-term:
- [ ] **Drone runtime** — `drone/run.py` reads from camera/RTSP, emits `{count, peak_xy, timestamp}` as JSONL.
- [ ] **ONNX export** — for Jetson TensorRT deployment.
- [ ] **Live-view trail** as time-series alongside the spatial mini-map.
- [ ] **Multi-model**: optionally swap in DM-Count for the live view (density-native, smaller, faster).

## Performance notes

- **Annotate inference**: ~600 ms per image on Apple Silicon MPS, ~1–3 s on CPU.
- **Live view at 800 ms interval**: keeps up on MPS, queues on CPU.
- **First inference is slow** (~4 s) because it includes model load. Subsequent are warm.
- **Dev build** of the Tauri shell is significantly slower than the release build (debug symbols + no optimizations). Run `npm run tauri build` for a representative end-user experience.

## Credits

- **P2PNet**: Song et al., *"Rethinking Counting and Localization in Crowds: A Purely Point-Based Framework"*, ICCV 2021. [TencentYoutuResearch/CrowdCounting-P2PNet](https://github.com/TencentYoutuResearch/CrowdCounting-P2PNet).
- **Pretrained weights** mirrored from [amirDev/crowd-counting-p2p](https://huggingface.co/spaces/amirDev/crowd-counting-p2p) on Hugging Face Spaces.
- **Academic datasets** referenced in the fine-tuning base: ShanghaiTech (Zhang et al., CVPR 2016), UCF-QNRF (Idrees et al., ECCV 2018), NWPU-Crowd (Wang et al., TPAMI 2020).
