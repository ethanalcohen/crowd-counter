"""Pixel ↔ ground plane projection.

Math overview:
  - Build the camera ray for pixel (px, py) using intrinsics
  - Apply roll (rotate around optical axis Z)
  - Apply pitch (rotate around X — camera tilts down)
  - Apply yaw (rotate around world Z — bearing)
  - Intersect ray with ground plane z=0 (drone at z=alt_m)
  - Return ground point in local meters + bearing + range
"""
from __future__ import annotations

import math

import numpy as np

from crowdcounter.world.telemetry import CameraIntrinsics, Telemetry, WorldPoint


def _rot_x(rad: float) -> np.ndarray:
    c, s = math.cos(rad), math.sin(rad)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def _rot_y(rad: float) -> np.ndarray:
    c, s = math.cos(rad), math.sin(rad)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def _rot_z(rad: float) -> np.ndarray:
    c, s = math.cos(rad), math.sin(rad)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def pixel_to_camera_ray(px: float, py: float, K: CameraIntrinsics) -> np.ndarray:
    """Unit ray from camera origin through the pixel, in camera frame.

    Camera frame: +X right, +Y down, +Z forward (out of the lens).
    """
    x = (px - K.cx) / K.fx
    y = (py - K.cy) / K.fy
    ray = np.array([x, y, 1.0], dtype=np.float64)
    return ray / np.linalg.norm(ray)


def camera_to_world_rotation(roll_deg: float, pitch_deg: float, yaw_deg: float) -> np.ndarray:
    """Rotation matrix taking a vector in camera frame and expressing it in world frame.

    World frame: X east, Y north, Z up.

    A nadir-pointing camera (pitch=-90) has its +Z (forward) aligned with world -Z.
    Pitch is the angle below horizontal: 0 = looking forward (horizon), -90 = straight down.
    """
    roll = math.radians(roll_deg)
    pitch = math.radians(pitch_deg)
    yaw = math.radians(yaw_deg)

    # 1) Base camera frame: identity (forward = +Z, right = +X, down = +Y).
    # 2) Pitch: rotate so a pitch of 0 means looking forward (along world +Y by default).
    #    For pitch=0, camera +Z should map to world +Y. So rebase by R_x(-90).
    #    Then apply additional pitch about world X (we treat positive pitch as nose up,
    #    so pitch=-90 means nose down by 90° = nadir).
    rebase = _rot_x(math.radians(-90))           # camera +Z → world +Y
    pitch_R = _rot_x(pitch)                       # tilt about world X (east)
    roll_R = _rot_z(roll)                         # roll about world Z (up)
    yaw_R = _rot_z(yaw)                           # bearing about world Z

    # Apply: roll (around lens), pitch, yaw, rebase to world
    return yaw_R @ pitch_R @ rebase @ roll_R


def pixel_to_ground(
    px: float, py: float, telemetry: Telemetry,
) -> WorldPoint | None:
    """Project an image pixel onto the ground plane (z=0).

    Returns None when the ray is parallel to or above the ground (would miss).
    """
    if telemetry.intrinsics is None:
        return None
    K = telemetry.intrinsics

    cam_ray = pixel_to_camera_ray(px, py, K)
    R = camera_to_world_rotation(telemetry.roll_deg, telemetry.pitch_deg, telemetry.yaw_deg)
    world_ray = R @ cam_ray                       # 3-vector in world frame

    # Camera origin at (0, 0, alt_m). Ground at z=0.
    # Parametric ray: P = origin + t * world_ray. Solve P.z = 0.
    if abs(world_ray[2]) < 1e-6:
        return None
    t = -telemetry.alt_m / world_ray[2]
    if t <= 0:
        return None  # ray points up, can't hit ground

    point = np.array([0.0, 0.0, telemetry.alt_m]) + t * world_ray
    x_m, y_m, _ = point.tolist()
    range_m = float(t)
    bearing_deg = (math.degrees(math.atan2(x_m, y_m)) + 360.0) % 360.0

    # naïve uncertainty: scales with range + small per-frame jitter
    uncertainty_m = max(0.5, range_m * 0.05)

    lat = lon = None
    if telemetry.lat is not None and telemetry.lon is not None:
        lat, lon = _meters_to_latlon(telemetry.lat, telemetry.lon, x_m, y_m)

    return WorldPoint(
        x_m=float(x_m), y_m=float(y_m),
        range_m=float(range_m), bearing_deg=float(bearing_deg),
        lat=lat, lon=lon,
        source=telemetry.source,
        uncertainty_m=uncertainty_m,
    )


def _meters_to_latlon(anchor_lat: float, anchor_lon: float, x_m: float, y_m: float) -> tuple[float, float]:
    """Flat-Earth approximation, fine for sub-km offsets."""
    R = 6371000.0
    dlat = math.degrees(y_m / R)
    dlon = math.degrees(x_m / (R * math.cos(math.radians(anchor_lat))))
    return anchor_lat + dlat, anchor_lon + dlon
