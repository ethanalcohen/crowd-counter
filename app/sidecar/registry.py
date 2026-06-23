from __future__ import annotations

import json
from pathlib import Path

from core.dataset import CollectionImage, CollectionManifest

REGISTRY_PATH = Path(__file__).resolve().parents[1] / "data" / "collections.json"


def load_registry() -> list[CollectionManifest]:
    raw = json.loads(REGISTRY_PATH.read_text())
    out: list[CollectionManifest] = []
    for c in raw["collections"]:
        images = [CollectionImage(**i) for i in c.get("images", [])]
        out.append(
            CollectionManifest(
                id=c["id"],
                name=c["name"],
                kind=c["kind"],
                region=c["region"],
                density=c["density"],
                description=c.get("description", ""),
                pre_annotated=c.get("pre_annotated", False),
                download_size_bytes=c.get("download_size_bytes"),
                images=images,
                archive_url=c.get("archive_url"),
                archive_format=c.get("archive_format"),
            )
        )
    return out


def get_collection(collection_id: str) -> CollectionManifest | None:
    for c in load_registry():
        if c.id == collection_id:
            return c
    return None
