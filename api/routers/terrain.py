from __future__ import annotations

import math

import numpy as np
from fastapi import APIRouter, Query

from ..errors import ApiError
from ..models.schemas import ProfileRequest
from ..scientific import dem

router = APIRouter(prefix="/api/terrain", tags=["terrain"])


@router.get("/coverage")
def coverage():
    tiles = [t.coverage() for t in dem.all_tiles().values()]
    return {"items": tiles, "note": "Only these cached windows carry numeric elevation. Outside them elevation is unavailable, never zero.",
            "vertical_datum": "MOLA areoid", "units": "metres"}


@router.get("/elevation")
def elevation(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=360)):
    tile = dem.find_tile(lat, lon)
    if tile is None:
        raise ApiError(404, "outside_dem_coverage", "No cached MOLA window covers this coordinate; elevation is not fabricated.", {"lat": lat, "lon": lon})
    s = tile.sample(lat, lon)
    if s.elevation_m is None:
        raise ApiError(422, "nodata", "The DEM has no data at this location.", {"lat": lat, "lon": lon})
    r, c = tile.nearest_cell(lat, lon)
    sl = tile.slope_deg[r, c]
    return {"lat": lat, "lon": s.lon, "elevation_m": s.elevation_m, "status": s.status, "interpolated": s.status == "interpolated",
            "local_slope_deg": None if np.isnan(sl) else float(sl), "tile_id": tile.id,
            "units": "metres above MOLA areoid", "resolution": dem.resolution_disclosure(tile)}


@router.post("/profile")
def profile(req: ProfileRequest):
    pts = [(p.lat, p.lon) for p in req.points]
    tile = dem.tile_for_points(pts)
    if tile is None:
        raise ApiError(422, "outside_dem_coverage", "All profile vertices must lie inside one cached MOLA window.")
    return dem.sample_profile(tile, pts)


@router.get("/profile")
def profile_get(lat1: float = Query(ge=-90, le=90), lon1: float = Query(ge=-180, le=360),
                lat2: float = Query(ge=-90, le=90), lon2: float = Query(ge=-180, le=360)):
    from ..models.schemas import Coordinate
    return profile(ProfileRequest(points=[Coordinate(lat=lat1, lon=lon1), Coordinate(lat=lat2, lon=lon2)]))


@router.get("/heightfield")
def heightfield(tile: str = Query("jezero"), lat_min: float | None = None, lat_max: float | None = None,
                lon_min: float | None = None, lon_max: float | None = None, max_size: int = Query(160, ge=16, le=256)):
    t = dem.all_tiles().get(tile)
    if t is None:
        raise ApiError(404, "unknown_tile", f"Unknown DEM window '{tile}'.", {"available": sorted(dem.all_tiles())})
    r0, c0 = (0, 0)
    r1, c1 = t.rows, t.cols
    if None not in (lat_min, lat_max, lon_min, lon_max):
        if not (lat_min < lat_max and lon_min < lon_max):
            raise ApiError(422, "bad_bbox", "bbox minimums must be below maximums.")
        r0 = max(0, int((t.lat_top - lat_max) / t.dlat)); r1 = min(t.rows, math.ceil((t.lat_top - lat_min) / t.dlat))
        c0 = max(0, int((lon_min - t.lon_left) / t.dlon)); c1 = min(t.cols, math.ceil((lon_max - t.lon_left) / t.dlon))
        if r1 - r0 < 3 or c1 - c0 < 3:
            raise ApiError(422, "bbox_outside_coverage", "Requested bbox does not overlap the window.")
    z, s = t.z[r0:r1, c0:c1], t.slope_deg[r0:r1, c0:c1]
    f = max(1, math.ceil(max(z.shape) / max_size))
    h, w = (z.shape[0] // f) * f, (z.shape[1] // f) * f
    zb = z[:h, :w].reshape(h // f, f, w // f, f)
    sb = s[:h, :w].reshape(h // f, f, w // f, f)
    zz = zb.mean(axis=(1, 3))           # NaN propagates: a pooled cell with any nodata stays missing
    ss = np.nanmean(sb, axis=(1, 3)) if f > 1 else sb[:, 0, :, 0]
    cell = lambda v: None if np.isnan(v) else round(float(v), 2)  # noqa: E731
    return {"tile_id": t.id, "rows": zz.shape[0], "cols": zz.shape[1],
            "bounds": {"lat_max": t.lat_top - r0 * t.dlat, "lat_min": t.lat_top - (r0 + h) * t.dlat,
                       "lon_min": t.lon_left + c0 * t.dlon, "lon_max": t.lon_left + (c0 + w) * t.dlon},
            "source_pixel_m": t.pixel_m, "display_pixel_m": t.pixel_m * f, "pooling_factor": f,
            "elevation_m": [cell(v) for v in zz.ravel()], "slope_deg": [cell(v) for v in ss.ravel()],
            "notes": ["Display product: block-mean of source cells (resampled for visualisation only).",
                      "Routing and profiles use full-resolution source cells, never this grid.",
                      "Slope is block-mean of 463 m Horn slopes."], "units": "metres above MOLA areoid"}
