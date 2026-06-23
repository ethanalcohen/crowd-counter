"""Dense-region centroid from a set of detection centers.

Approach: coarse grid-bin the points, find the heaviest cell, then take the
centroid of all points within a fixed radius of that cell's center. This is
deliberately simple and stable across frames — argmax of a heatmap is too
jumpy for what we want here.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Cluster:
    cx: float
    cy: float
    radius_px: float
    member_count: int


def cluster_centroid(
    points: list[tuple[float, float]],
    image_size: tuple[int, int],
    grid: int = 16,
    radius_frac: float = 0.18,
) -> Cluster | None:
    """Return the centroid of the densest region, or None if no points."""
    if not points:
        return None

    w, h = image_size
    pts = np.asarray(points, dtype=np.float32)              # (N, 2)
    if pts.shape[0] == 1:
        return Cluster(cx=float(pts[0, 0]), cy=float(pts[0, 1]),
                       radius_px=0.0, member_count=1)

    # 1. Bin into grid x grid cells, find the heaviest bin.
    gx = np.clip((pts[:, 0] / max(w, 1) * grid).astype(int), 0, grid - 1)
    gy = np.clip((pts[:, 1] / max(h, 1) * grid).astype(int), 0, grid - 1)
    hist = np.zeros((grid, grid), dtype=np.int32)
    np.add.at(hist, (gy, gx), 1)
    iy, ix = np.unravel_index(int(np.argmax(hist)), hist.shape)

    # 2. Seed point = center of that bin in pixels.
    seed_x = (ix + 0.5) * w / grid
    seed_y = (iy + 0.5) * h / grid

    # 3. Collect all detections within radius of the seed.
    radius_px = float(radius_frac * np.hypot(w, h))
    dx = pts[:, 0] - seed_x
    dy = pts[:, 1] - seed_y
    mask = (dx * dx + dy * dy) <= radius_px * radius_px
    members = pts[mask]
    if members.shape[0] == 0:
        members = pts            # degenerate fallback

    cx = float(members[:, 0].mean())
    cy = float(members[:, 1].mean())

    # 4. Effective radius = how spread out the members actually are.
    spread = float(np.hypot(
        members[:, 0].std() if members.shape[0] > 1 else 0.0,
        members[:, 1].std() if members.shape[0] > 1 else 0.0,
    ))

    return Cluster(
        cx=cx, cy=cy,
        radius_px=max(spread, 8.0),
        member_count=int(members.shape[0]),
    )
