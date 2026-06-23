from __future__ import annotations

import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator

import httpx

from core.dataset import CollectionImage, CollectionManifest
from core.paths import collection_root


@dataclass
class ProgressEvent:
    collection_id: str
    phase: str            # "download" | "extract" | "done" | "error"
    current: int = 0
    total: int = 0
    message: str = ""


def _image_filename(img: CollectionImage, index: int) -> str:
    if img.name:
        return img.name
    suffix = ".jpg"
    if img.source_url:
        tail = img.source_url.rsplit("?", 1)[0].rsplit("/", 1)[-1]
        if "." in tail:
            suffix = "." + tail.rsplit(".", 1)[-1].lower()
            if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
                suffix = ".jpg"
    return f"{index:04d}{suffix}"


async def download_collection(
    manifest: CollectionManifest,
) -> AsyncIterator[ProgressEvent]:
    root = collection_root(manifest.id)

    if manifest.kind == "academic" and manifest.archive_url:
        async for evt in _download_archive(manifest, root):
            yield evt
        return

    async for evt in _download_images(manifest, root):
        yield evt


async def _download_images(
    manifest: CollectionManifest, root: Path
) -> AsyncIterator[ProgressEvent]:
    images_dir = root / "images"
    total = len(manifest.images)
    if total == 0:
        yield ProgressEvent(manifest.id, "done", 0, 0, "empty manifest")
        return

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        for i, img in enumerate(manifest.images, start=1):
            target = images_dir / _image_filename(img, i)
            if target.exists() and target.stat().st_size > 0:
                yield ProgressEvent(manifest.id, "download", i, total, f"cached {target.name}")
                continue
            if not img.source_url:
                yield ProgressEvent(manifest.id, "download", i, total, f"no url for {target.name}")
                continue
            try:
                async with client.stream("GET", img.source_url) as r:
                    r.raise_for_status()
                    with target.open("wb") as f:
                        async for chunk in r.aiter_bytes(64 * 1024):
                            f.write(chunk)
                yield ProgressEvent(manifest.id, "download", i, total, target.name)
            except Exception as e:
                yield ProgressEvent(
                    manifest.id, "error", i, total, f"{target.name}: {e}"
                )

    yield ProgressEvent(manifest.id, "done", total, total)


async def _download_archive(
    manifest: CollectionManifest, root: Path
) -> AsyncIterator[ProgressEvent]:
    assert manifest.archive_url
    archive = root / f"_archive{_suffix_for(manifest.archive_format)}"
    if not archive.exists() or archive.stat().st_size == 0:
        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            async with client.stream("GET", manifest.archive_url) as r:
                r.raise_for_status()
                total = int(r.headers.get("content-length", 0))
                downloaded = 0
                with archive.open("wb") as f:
                    async for chunk in r.aiter_bytes(1024 * 1024):
                        f.write(chunk)
                        downloaded += len(chunk)
                        yield ProgressEvent(
                            manifest.id, "download", downloaded, total, archive.name
                        )

    yield ProgressEvent(manifest.id, "extract", 0, 0, "extracting")
    images_dir = root / "images"
    if manifest.archive_format == "zip":
        with zipfile.ZipFile(archive) as zf:
            for name in zf.namelist():
                if name.lower().endswith((".jpg", ".jpeg", ".png")):
                    target = images_dir / Path(name).name
                    if target.exists():
                        continue
                    with zf.open(name) as src, target.open("wb") as dst:
                        shutil.copyfileobj(src, dst)
    else:
        yield ProgressEvent(
            manifest.id, "error", 0, 0, f"unsupported format {manifest.archive_format}"
        )
        return

    yield ProgressEvent(manifest.id, "done", 0, 0)


def _suffix_for(fmt: str | None) -> str:
    return {"zip": ".zip", "tar.gz": ".tar.gz"}.get(fmt or "", ".bin")
