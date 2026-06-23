from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

Region = Literal["na", "me", "ea", "global"]
Density = Literal["urban", "rural", "mixed"]
Kind = Literal["academic", "regional", "user"]


@dataclass
class CollectionImage:
    name: str                              # filename on disk
    source_url: str | None = None          # remote source if downloaded
    source: str | None = None              # "unsplash" | "pexels" | "shanghaitech" | "user"
    photographer: str | None = None
    license: str | None = None
    width: int | None = None
    height: int | None = None


@dataclass
class CollectionManifest:
    """Static metadata for a built-in collection. Ships with the app."""
    id: str
    name: str
    kind: Kind
    region: Region
    density: Density
    description: str = ""
    pre_annotated: bool = False
    download_size_bytes: int | None = None
    images: list[CollectionImage] = field(default_factory=list)
    # Academic collections use a single archive URL instead of per-image URLs.
    archive_url: str | None = None
    archive_format: str | None = None       # "zip" | "tar.gz"


@dataclass
class AnnotationPoint:
    x: float
    y: float
    confidence: float = 1.0
    source: Literal["model", "user"] = "user"


@dataclass
class Annotation:
    image_name: str
    points: list[AnnotationPoint]
    image_size: tuple[int, int]             # (width, height)
    region: Region
    density: Density
    reviewed: bool = False

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)

    @classmethod
    def from_json(cls, text: str) -> "Annotation":
        d = json.loads(text)
        d["points"] = [AnnotationPoint(**p) for p in d["points"]]
        d["image_size"] = tuple(d["image_size"])
        return cls(**d)


def annotations_dir(collection_root: Path) -> Path:
    return collection_root / "annotations"


def images_dir(collection_root: Path) -> Path:
    return collection_root / "images"


def load_annotation(collection_root: Path, image_name: str) -> Annotation | None:
    path = annotations_dir(collection_root) / f"{Path(image_name).stem}.json"
    if not path.exists():
        return None
    return Annotation.from_json(path.read_text())


def save_annotation(collection_root: Path, annotation: Annotation) -> Path:
    out = annotations_dir(collection_root)
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{Path(annotation.image_name).stem}.json"
    path.write_text(annotation.to_json())
    return path
