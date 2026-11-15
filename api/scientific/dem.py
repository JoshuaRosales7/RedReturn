"""Numeric DEM access for NASA MOLA elevation (MEGDR 463 m) windows.

Rules enforced here (see docs/SCIENTIFIC_VALIDATION.md):
* values are int16 metres relative to the MOLA areoid; nodata stays NaN, never 0;
* every sample reports whether it is a cell value, a bilinear interpolation,
  nodata, or outside the cached coverage;
* slopes are Horn 3x3 gradients at 463 m baseline: they say nothing about
  rover-scale (<1 km) hazards.
"""
from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np
import rasterio

from .geodesy import MARS_RADIUS_M, haversine_km, interpolate_great_circle, normalize_lon

DEM_DIR = Path(__file__).resolve().parent.parent / "data" / "dem"
SampleStatus = Literal["cell_value", "interpolated", "nodata", "outside_coverage"]


class DemError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


@dataclass
class Sample:
    lat: float
    lon: float
    elevation_m: float | None
    status: SampleStatus


@dataclass
class DemTile:
    meta: dict
    z: np.ndarray                      # float64 metres, NaN = nodata
    lon_left: float                    # degrees, west edge of pixel (0,0)
    lat_top: float                     # degrees, north edge of pixel (0,0)
    dlon: float                        # pixel width, degrees
    dlat: float                        # pixel height, degrees (positive)
    _slope: np.ndarray | None = field(default=None, repr=False)

    @property
    def id(self) -> str: return self.meta["id"]
    @property
    def rows(self) -> int: return self.z.shape[0]
    @property
    def cols(self) -> int: return self.z.shape[1]
    @property
    def pixel_m(self) -> float: return math.radians(self.dlat) * MARS_RADIUS_M
    @property
    def lon_right(self) -> float: return self.lon_left + self.cols * self.dlon
    @property
    def lat_bottom(self) -> float: return self.lat_top - self.rows * self.dlat

    def contains(self, lat: float, lon: float) -> bool:
        lon = normalize_lon(lon)
        return self.lat_bottom <= lat <= self.lat_top and self.lon_left <= lon <= self.lon_right

    def to_rc(self, lat: float, lon: float) -> tuple[float, float]:
        """Fractional (row, col) in pixel-edge coordinates (cell centres at +0.5)."""
        return (self.lat_top - lat) / self.dlat, (normalize_lon(lon) - self.lon_left) / self.dlon

    def cell_center(self, row: int, col: int) -> tuple[float, float]:
        return self.lat_top - (row + 0.5) * self.dlat, self.lon_left + (col + 0.5) * self.dlon

    def nearest_cell(self, lat: float, lon: float) -> tuple[int, int]:
        r, c = self.to_rc(lat, lon)
        return min(self.rows - 1, max(0, int(r))), min(self.cols - 1, max(0, int(c)))

    def sample(self, lat: float, lon: float) -> Sample:
        if not self.contains(lat, lon):
            return Sample(lat, normalize_lon(lon), None, "outside_coverage")
        r, c = self.to_rc(lat, lon)
        u, v = r - 0.5, c - 0.5                      # continuous index of cell centres
        ur, vr = round(u), round(v)
        if abs(u - ur) < 1e-6 and abs(v - vr) < 1e-6 and 0 <= ur < self.rows and 0 <= vr < self.cols:
            val = self.z[ur, vr]                      # query sits on a cell centre: return the cell value itself
            return Sample(lat, normalize_lon(lon), None if np.isnan(val) else float(val),
                          "nodata" if np.isnan(val) else "cell_value")
        r0, c0 = math.floor(u), math.floor(v)
        if r0 < 0 or c0 < 0 or r0 + 1 >= self.rows or c0 + 1 >= self.cols:
            val = self.z[min(self.rows - 1, max(0, int(r))), min(self.cols - 1, max(0, int(c)))]
            return Sample(lat, normalize_lon(lon), None if np.isnan(val) else float(val),
                          "nodata" if np.isnan(val) else "cell_value")
        fr, fc = u - r0, v - c0
        if fr < 1e-9 and fc < 1e-9:
            val = self.z[r0, c0]
            return Sample(lat, normalize_lon(lon), None if np.isnan(val) else float(val),
                          "nodata" if np.isnan(val) else "cell_value")
        block = self.z[r0:r0 + 2, c0:c0 + 2]
        if np.isnan(block).any():
            return Sample(lat, normalize_lon(lon), None, "nodata")
        val = (block[0, 0] * (1 - fr) * (1 - fc) + block[0, 1] * (1 - fr) * fc
               + block[1, 0] * fr * (1 - fc) + block[1, 1] * fr * fc)
        return Sample(lat, normalize_lon(lon), float(val), "interpolated")

    # --- slope ---------------------------------------------------------------------------
    @property
    def slope_deg(self) -> np.ndarray:
        """Horn (1981) slope in degrees; NaN where any of the 8 neighbours is nodata or at the border."""
        if self._slope is None:
            z = self.z
            lat_rows = self.lat_top - (np.arange(self.rows) + 0.5) * self.dlat
            dy = math.radians(self.dlat) * MARS_RADIUS_M
            dx = (np.maximum(np.cos(np.radians(lat_rows)), 1e-6) * math.radians(self.dlon) * MARS_RADIUS_M)[1:-1, None]
            a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
            d, f = z[1:-1, :-2], z[1:-1, 2:]
            g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
            dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx)
            dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * dy)
            s = np.full(z.shape, np.nan)
            s[1:-1, 1:-1] = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
            s[np.isnan(z)] = np.nan   # no elevation at the cell itself -> no slope either
            self._slope = s
        return self._slope

    def row_spacing_m(self, row: int) -> tuple[float, float]:
        """Ground size (east-west, north-south) of one pixel at a row, in metres."""
        lat = self.lat_top - (row + 0.5) * self.dlat
        return (max(math.cos(math.radians(lat)), 1e-6) * math.radians(self.dlon) * MARS_RADIUS_M,
                math.radians(self.dlat) * MARS_RADIUS_M)

    def coverage(self) -> dict:
        valid = ~np.isnan(self.z)
        return {
            "id": self.id, "name": self.meta["name"],
            "bounds": {"lat_min": self.lat_bottom, "lat_max": self.lat_top,
                       "lon_min": self.lon_left, "lon_max": self.lon_right},
            "rows": self.rows, "cols": self.cols,
            "pixel_size_m": self.pixel_m, "valid_fraction": float(valid.mean()),
            "nodata_cells": int((~valid).sum()),
            "elevation_min_m": float(np.nanmin(self.z)), "elevation_max_m": float(np.nanmax(self.z)),
        }


def _load(meta_path: Path) -> DemTile:
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    tif = meta_path.with_name(meta["file"])
    if not tif.exists():
        raise DemError("dem_file_missing", f"DEM file {tif.name} is missing; run scripts/build_mola_windows.py")
    with rasterio.open(tif) as ds:
        raw = ds.read(1)
        nodata = ds.nodata
        t = ds.transform
        R = MARS_RADIUS_M
        lon_left = math.degrees(t.c / R)
        lat_top = math.degrees(t.f / R)
        dlon = math.degrees(t.a / R)
        dlat = math.degrees(-t.e / R)
    z = raw.astype(np.float64)
    if nodata is not None:
        z[raw == nodata] = np.nan
    return DemTile(meta=meta, z=z, lon_left=lon_left, lat_top=lat_top, dlon=dlon, dlat=dlat)


# windows downloaded for user routes (api/datasets/mola_remote.py); overridable so tests never see real downloads
ONDEMAND_DIR = Path(os.getenv("REDRETURN_DEM_CACHE_DIR") or DEM_DIR / "ondemand")


def sidecars() -> list[Path]:
    """Shipped windows first (they win when windows overlap), then on-demand downloads."""
    return sorted(DEM_DIR.glob("mola_*.json")) + sorted(ONDEMAND_DIR.glob("mola_*.json"))


@lru_cache(maxsize=1)
def _registry() -> dict[str, DemTile]:
    tiles: dict[str, DemTile] = {}
    for p in sidecars():
        tile = _load(p)
        tiles[tile.id] = tile
    return tiles


def remove_tile(tile_id: str) -> None:
    _registry().pop(tile_id, None)


def add_tile(meta_path: Path) -> DemTile:
    """Register a window written at runtime (on-demand download) without reloading the others."""
    tile = _load(meta_path)
    _registry().setdefault(tile.id, tile)
    return _registry()[tile.id]


def all_tiles() -> dict[str, DemTile]:
    return _registry()


def find_tile(lat: float, lon: float) -> DemTile | None:
    for tile in _registry().values():
        if tile.contains(lat, lon):
            return tile
    return None


def tile_for_points(points: list[tuple[float, float]]) -> DemTile | None:
    for tile in _registry().values():
        if all(tile.contains(*p) for p in points):
            return tile
    return None


# --- profiles ----------------------------------------------------------------------------
def sample_profile(tile: DemTile, points: list[tuple[float, float]], max_samples: int = 2000) -> dict:
    """Sample an ordered polyline (great-circle between vertices) at <= one pixel spacing."""
    pts: list[tuple[float, float]] = []
    for a, b in zip(points[:-1], points[1:]):
        length_m = haversine_km(*a, *b) * 1000
        n = max(1, math.ceil(length_m / tile.pixel_m))
        seg = interpolate_great_circle(*a, *b, n)
        pts.extend(seg if not pts else seg[1:])
    if len(pts) > max_samples:
        raise DemError("too_many_samples", f"Profile needs {len(pts)} samples; limit is {max_samples}.",
                       {"limit": max_samples, "required": len(pts)})
    return profile_from_points(tile, pts)


def profile_from_points(tile: DemTile, pts: list[tuple[float, float]]) -> dict:
    dist = [0.0]
    for a, b in zip(pts[:-1], pts[1:]):
        dist.append(dist[-1] + haversine_km(*a, *b) * 1000)
    samples = [tile.sample(*p) for p in pts]
    slope_grid = tile.slope_deg
    elev = [s.elevation_m for s in samples]
    along: list[float | None] = [None]
    local: list[float | None] = []
    for s in samples:
        if s.status in ("outside_coverage", "nodata"):
            local.append(None)
        else:
            r, c = tile.nearest_cell(s.lat, s.lon)
            v = slope_grid[r, c]
            local.append(None if np.isnan(v) else float(v))
    gain = loss = 0.0
    gaps = 0
    max_along = 0.0
    for i in range(1, len(pts)):
        z0, z1, d = elev[i - 1], elev[i], dist[i] - dist[i - 1]
        if z0 is None or z1 is None or d <= 0:
            along.append(None)
            gaps += 1
            continue
        dz = z1 - z0
        sl = math.degrees(math.atan2(abs(dz), d))
        along.append(sl)
        max_along = max(max_along, sl)
        gain += max(dz, 0)
        loss += max(-dz, 0)
    n = len(samples)
    count = lambda st: sum(1 for s in samples if s.status == st)  # noqa: E731
    valid_elev = [e for e in elev if e is not None]
    return {
        "tile_id": tile.id, "length_m": dist[-1],
        "samples": [{"lat": s.lat, "lon": s.lon, "distance_m": dist[i], "elevation_m": s.elevation_m,
                     "status": s.status, "along_track_slope_deg": along[i], "local_slope_deg": local[i]}
                    for i, s in enumerate(samples)],
        "stats": {
            "n_samples": n, "sample_spacing_m": dist[-1] / max(1, n - 1),
            "elevation_min_m": min(valid_elev) if valid_elev else None,
            "elevation_max_m": max(valid_elev) if valid_elev else None,
            "gain_m": gain, "loss_m": loss, "net_m": (valid_elev[-1] - valid_elev[0]) if len(valid_elev) > 1 else None,
            "max_along_track_slope_deg": max_along if n > 1 else None,
            "max_local_slope_deg": max([v for v in local if v is not None], default=None),
            "nodata_samples": count("nodata"), "outside_coverage_samples": count("outside_coverage"),
            "interpolated_samples": count("interpolated"), "cell_value_samples": count("cell_value"),
            "gap_segments": gaps,
        },
        "resolution": resolution_disclosure(tile),
    }


def resolution_disclosure(tile: DemTile) -> dict:
    return {
        "pixel_size_m": tile.pixel_m,
        "smallest_resolvable_feature_m": 2 * tile.pixel_m,
        "vertical_uncertainty_m": 3.0,
        "statement": (f"Source grid spacing is {tile.pixel_m:.0f} m. Boulders, dunes, small craters, ripples and "
                      "rover-scale slopes (<~1 km) are NOT resolved; slopes are averaged over ~1.4 km. "
                      "Terrain-evaluated is not mission-safe."),
    }
