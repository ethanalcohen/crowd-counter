"""Telemetry and world-coordinate dataclasses.

This is the unified schema fed into projection math. Two sources produce it:
- Real drone (MAVLink/DJI SDK, eventually) — exact values
- PerspectiveFields NN (now) — estimated roll/pitch/FOV from one frame +
  user-typed altitude. Same downstream consumer.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from typing import Literal

Source = Literal["drone", "estimated", "manual", "none"]


@dataclass
class CameraIntrinsics:
    """Pinhole camera model. Focal lengths in pixels."""
    fx: float
    fy: float
    cx: float
    cy: float
    width: int
    height: int

    @classmethod
    def from_vfov(cls, vfov_deg: float, width: int, height: int) -> "CameraIntrinsics":
        """Build from vertical FOV; assume square pixels, principal point at center."""
        fy = (height / 2) / math.tan(math.radians(vfov_deg) / 2)
        fx = fy
        return cls(fx=fx, fy=fy, cx=width / 2, cy=height / 2,
                   width=width, height=height)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Telemetry:
    """One frame of camera + platform state.

    Frame conventions:
    - World frame: X east, Y north, Z up. Origin = drone position projected to ground.
    - Camera frame: looks down +Z (image plane). +X right (pixel x), +Y down (pixel y).
    - Drone attitude: yaw is bearing (0=north, positive=clockwise), pitch is nose tilt
      (positive=down), roll is wing roll (positive=right wing down).
    - Camera mount pitch: 0 = forward-looking, -90 = straight down (nadir).
    """
    alt_m: float                            # drone altitude above ground (meters AGL)
    pitch_deg: float                        # combined drone+gimbal pitch (camera optical axis tilt from horizontal; -90 = nadir)
    roll_deg: float = 0.0                   # roll about optical axis
    yaw_deg: float = 0.0                    # bearing of camera optical axis (0=N)
    lat: float | None = None                # drone GPS (optional)
    lon: float | None = None
    intrinsics: CameraIntrinsics | None = None
    source: Source = "manual"
    confidence: float = 1.0                 # 0..1
    t_ms: float = 0.0

    def to_dict(self) -> dict:
        d = asdict(self)
        return d


@dataclass
class WorldPoint:
    """Result of projecting an image pixel to the ground plane.

    All meters are local frame relative to the drone position (X east, Y north,
    Z up). lat/lon populated only when telemetry has a GPS anchor.
    """
    x_m: float
    y_m: float
    range_m: float                          # 3D distance from camera to point
    bearing_deg: float                      # 0=north, clockwise
    lat: float | None = None
    lon: float | None = None
    source: Source = "manual"
    uncertainty_m: float = 0.0              # rough 1-sigma uncertainty estimate

    def to_dict(self) -> dict:
        return asdict(self)
