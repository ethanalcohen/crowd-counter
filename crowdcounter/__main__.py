"""Entry point: `python -m crowdcounter` boots the server + opens a window.

In dev, the Vite server runs on :5173 and the window points there for HMR.
In production, the built static assets are served by FastAPI itself.
"""
from __future__ import annotations

import argparse
import os
import threading
import time

import uvicorn


def _serve(host: str, port: int) -> None:
    from crowdcounter.server import app
    uvicorn.run(app, host=host, port=port, log_level="info")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17893)
    parser.add_argument("--dev", action="store_true",
                        help="point the window at the Vite dev server (:5173) instead of the bundled app")
    parser.add_argument("--no-window", action="store_true",
                        help="just run the server, don't open a window (for headless dev)")
    args = parser.parse_args()

    # Boot the server in a background thread
    t = threading.Thread(target=_serve, args=(args.host, args.port), daemon=True)
    t.start()

    # Wait for it to come up
    import urllib.request
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"http://{args.host}:{args.port}/api/health", timeout=0.5)
            break
        except Exception:
            time.sleep(0.1)

    if args.no_window:
        t.join()
        return

    url = "http://localhost:5173" if args.dev else f"http://{args.host}:{args.port}"

    import webview
    webview.create_window("Crowd Counter", url, width=1400, height=900, min_size=(1000, 700))
    webview.start()


if __name__ == "__main__":
    main()
