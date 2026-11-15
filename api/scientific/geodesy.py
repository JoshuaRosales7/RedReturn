"""Spherical Mars geodesy. Single authoritative implementation (mirrored in lib/mars.ts).

Reference sphere: 3,396,190 m, the radius of the Mars 2000 sphere on which the
MOLA MEGDR grids are projected. Using the same radius for route geometry and DEM
sampling keeps pixel spacing and ground distances consistent. The IAU mean
radius (3,389.5 km) differs by 0.2 %; the choice is documented in
docs/SCIENTIFIC_VALIDATION.md.
Convention: planetocentric latitude, east-positive longitude.
"""
from __future__ import annotations

from math import acos, asin, atan2, cos, degrees, radians, sin, sqrt

MARS_RADIUS_M = 3_396_190.0
MARS_RADIUS_KM = MARS_RADIUS_M / 1000.0


def normalize_lon(lon: float) -> float:
    """Wrap to [-180, 180)."""
    return (lon + 540.0) % 360.0 - 180.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dp = radians(lat2 - lat1)
    dl = radians(normalize_lon(lon2 - lon1))
    h = sin(dp / 2) ** 2 + cos(p1) * cos(p2) * sin(dl / 2) ** 2
    return 2 * MARS_RADIUS_KM * asin(min(1.0, sqrt(h)))


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = radians(lat1), radians(lat2)
    dl = radians(normalize_lon(lon2 - lon1))
    y = sin(dl) * cos(p2)
    x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
    return (degrees(atan2(y, x)) + 360.0) % 360.0


def interpolate_great_circle(lat1: float, lon1: float, lat2: float, lon2: float, steps: int) -> list[tuple[float, float]]:
    """steps+1 points along the minor great-circle arc (inclusive of both ends)."""
    if steps < 1:
        raise ValueError("steps must be >= 1")
    ang = haversine_km(lat1, lon1, lat2, lon2) / MARS_RADIUS_KM
    if ang < 1e-12:
        return [(lat1, normalize_lon(lon1))] * (steps + 1)
    p1, l1, p2, l2 = radians(lat1), radians(lon1), radians(lat2), radians(lon2)
    sa = sin(ang)
    out: list[tuple[float, float]] = []
    for i in range(steps + 1):
        f = i / steps
        a, b = sin((1 - f) * ang) / sa, sin(f * ang) / sa
        x = a * cos(p1) * cos(l1) + b * cos(p2) * cos(l2)
        y = a * cos(p1) * sin(l1) + b * cos(p2) * sin(l2)
        z = a * sin(p1) + b * sin(p2)
        out.append((degrees(atan2(z, sqrt(x * x + y * y))), normalize_lon(degrees(atan2(y, x)))))
    out[0] = (lat1, normalize_lon(lon1))
    out[-1] = (lat2, normalize_lon(lon2))
    return out


def polyline_km(points: list[tuple[float, float]]) -> float:
    return sum(haversine_km(*points[i], *points[i + 1]) for i in range(len(points) - 1))


__all__ = ["MARS_RADIUS_M", "MARS_RADIUS_KM", "normalize_lon", "haversine_km", "initial_bearing",
           "interpolate_great_circle", "polyline_km", "acos"]
