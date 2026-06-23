from __future__ import annotations

from pathlib import Path

from platformdirs import user_data_dir

APP_NAME = "CrowdCounter"
APP_AUTHOR = "CrowdCounter"


def app_data_root() -> Path:
    root = Path(user_data_dir(APP_NAME, APP_AUTHOR))
    root.mkdir(parents=True, exist_ok=True)
    return root


def collections_root() -> Path:
    p = app_data_root() / "collections"
    p.mkdir(parents=True, exist_ok=True)
    return p


def collection_root(collection_id: str) -> Path:
    p = collections_root() / collection_id
    (p / "images").mkdir(parents=True, exist_ok=True)
    (p / "annotations").mkdir(parents=True, exist_ok=True)
    return p


def weights_root() -> Path:
    p = app_data_root() / "weights"
    p.mkdir(parents=True, exist_ok=True)
    return p
