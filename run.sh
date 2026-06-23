#!/usr/bin/env bash
# Crowd Counter — one-command dev launcher.
#
# Boots Vite (frontend HMR) and the Python sidecar+window together.
# Ctrl-C kills both.

set -euo pipefail
cd "$(dirname "$0")"

MODE="${1:-dev}"

case "$MODE" in
  dev)
    # First-run guards — cheap when nothing changed.
    [[ -d .venv ]] || uv sync
    [[ -d web/node_modules ]] || (cd web && npm install)

    # Start Vite in the background; trap kills it on exit.
    (cd web && npm run dev) &
    VITE_PID=$!
    trap 'kill $VITE_PID 2>/dev/null || true' EXIT INT TERM

    # Give Vite a beat to bind 5173 before pywebview reaches for it.
    sleep 1
    uv run python -m crowdcounter --dev
    ;;

  build)
    # Production: bundle the Svelte app and serve it from the Python process.
    (cd web && npm install && npm run build)
    uv run python -m crowdcounter
    ;;

  headless)
    # API only, no window. Useful for poking at /api/* with curl or another client.
    uv run python -m crowdcounter --no-window
    ;;

  *)
    echo "usage: $0 [dev|build|headless]" >&2
    echo "  dev       Vite HMR + Python sidecar + window  (default)"
    echo "  build     build the Svelte bundle, serve from Python"
    echo "  headless  Python API only, no window"
    exit 2
    ;;
esac
