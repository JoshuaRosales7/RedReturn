"""Orchestration: tile lookup, route alternatives, mission evaluation per route. No HTTP concerns here."""
from __future__ import annotations

import hashlib
import json
import math
from functools import lru_cache

import numpy as np

from ..errors import ApiError
from ..datasets import mola_remote
from ..scientific import dem
from ..scientific.geodesy import haversine_km
from ..scientific.mission import RouteSummary, evaluate
from ..scientific.routing import Mobility, optimised_route, shortest_route

LIMITATIONS = [
    "463 m elevation grid: rover-scale slopes, rocks, dunes and soft soil are not resolved or modelled.",
    "A route that satisfies the slope cap on this grid is terrain-evaluated, never terrain-safe or mission-safe.",
    "Resource rates, speed derating and constraint limits are editable assumptions, not validated vehicle data.",
    "This prototype cannot certify any route or mission for human exploration.",
]


_REMOTE_STATUS = {"download_rate_limited": 429, "grid_too_large": 422, "crosses_antimeridian": 422, "nodata": 422, "dem_download_failed": 502, "dem_source_changed": 502}


def require_tile(points: list[tuple[float, float]], extra: list[tuple[float, float]] | None = None) -> dem.DemTile:
    """Cached MOLA window containing all points; outside them, download the real MOLA window on demand (never fabricate)."""
    tile = dem.tile_for_points(points)
    if tile is None and mola_remote.enabled():
        try:
            sidecar = mola_remote.fetch_window(points + (extra or []))
            tile = dem.add_tile(sidecar)
            evicted = mola_remote.evict(keep=sidecar)
            for wid in evicted:
                dem.remove_tile(wid)
            if evicted:
                plan_cached.cache_clear()
        except mola_remote.RemoteDemError as e:
            raise ApiError(_REMOTE_STATUS.get(e.code, 502), e.code, e.message, e.details) from e
        if not all(tile.contains(*p) for p in points):
            tile = None
    if tile is None:
        raise ApiError(422, "outside_dem_coverage",
                       "Origin and destination must both lie inside one cached MOLA window.",
                       {"windows": [t.coverage()["bounds"] | {"id": t.id} for t in dem.all_tiles().values()]})
    return tile


def stops_key(stops) -> tuple:
    return tuple((s.lat, s.lon, s.dwell_hours, s.weight, s.name or "") for s in stops)


def stops_from_key(key: tuple) -> list[dict]:
    return [{"lat": a, "lon": b, "dwell_hours": c, "weight": d, "name": e or None} for a, b, c, d, e in key]


@lru_cache(maxsize=256)
def plan_cached(tile_id: str, strategy: str, a: tuple, b: tuple, mob: Mobility, skey: tuple) -> dict:
    tile = dem.all_tiles()[tile_id]
    if strategy == "shortest":
        return shortest_route(tile, a, b, mob)
    return optimised_route(tile, strategy, a, b, mob, stops=stops_from_key(skey))


def public(route: dict) -> dict:
    return {k: v for k, v in route.items() if not k.startswith("_")}


def config_for(route: dict, cfg):
    """Science route adds the dwell of declared stops to the science budget."""
    visited = route.get("science_stops_visited") or []
    extra = sum(s["dwell_hours"] for s in visited)
    return cfg.model_copy(update={"science_hours": cfg.science_hours + extra}) if extra else cfg


def summary_of(route: dict) -> RouteSummary:
    return route["_summary_obj"]


def science_value(route: dict, stops: list[dict]) -> float:
    return 1.0 + sum(s["weight"] for s in (route.get("science_stops_visited") or []))


def _span_deg(p, q) -> float:
    """Largest latitude / longitude separation in degrees (longitude difference taken the short way round)."""
    return max(abs(p[0] - q[0]), abs(((p[1] - q[1]) + 540) % 360 - 180))


def check_stops_near(a, b, stops) -> None:
    """Science stops must lie in the local planning area of the route (else a forgotten stop would drag the area elsewhere)."""
    far = [s for s in stops if _span_deg((s.lat, s.lon), a) > mola_remote.MAX_SPAN_DEG or _span_deg((s.lat, s.lon), b) > mola_remote.MAX_SPAN_DEG]
    if far:
        s = far[0]
        km = min(haversine_km(s.lat, s.lon, *a), haversine_km(s.lat, s.lon, *b))
        raise ApiError(422, "stop_outside_area",
                       f"Science stop '{s.name or 'unnamed'}' is {km:,.0f} km from the route; stops must lie within {mola_remote.MAX_SPAN_DEG:.0f}° "
                       "of both base and target. Move or remove it in Planner.",
                       {"stops": [{"name": x.name, "lat": x.lat, "lon": x.lon} for x in far]})


def alternatives(origin, dest, cfg, stops, strategies) -> dict:
    a, b = (origin.lat, origin.lon), (dest.lat, dest.lon)
    check_stops_near(a, b, stops)
    tile = require_tile([a, b], [(s.lat, s.lon) for s in stops])
    mob = Mobility.from_config(cfg)
    skey = stops_key(stops)
    out = []
    for st in strategies:
        route = plan_cached(tile.id, st, a, b, mob, skey)
        cfg_r = config_for(route, cfg)
        mission = evaluate(summary_of(route), cfg_r)
        item = public(route)
        item["mission"] = mission
        item["science_value"] = science_value(route, skey) if st == "science" and route["status"] == "ok" else 1.0
        item["mission_config_science_hours"] = cfg_r.science_hours
        out.append(item)
    rec, why = recommend(out)
    return {"tile": tile.coverage(), "resolution": dem.resolution_disclosure(tile), "routes": out, "recommended": rec,
            "comparison": compare(out), "reason": why, "limitations": LIMITATIONS,
            "certification": "NOT_CERTIFIABLE"}


def _viable(r: dict) -> bool:
    return r["status"] != "failed" and not r["constraints_violated"] and r["mission"]["feasible_within_model"]


def recommend(routes: list[dict]) -> tuple[str | None, str]:
    viable = [r for r in routes if _viable(r)]
    if viable:
        best = max(viable, key=lambda r: (r["mission"]["limiting_margin_percent"], -r["mission"]["duration_hours"]))
        others = [r for r in routes if r is not best]
        parts = [f"{best['strategy']} has the largest limiting margin ({best['mission']['limiting_margin_percent']:.1f}% on "
                 f"{best['mission']['limiting_factor']}) among routes with no slope/data violations that satisfy every modelled constraint."]
        for o in others:
            if o["constraints_violated"]:
                parts.append(f"{o['strategy']} violates: " + "; ".join(v["id"] for v in o["constraints_violated"]) + ".")
            elif not o["mission"]["feasible_within_model"]:
                parts.append(f"{o['strategy']} fails modelled constraints ({o['mission']['limiting_factor']}).")
            else:
                d = o["mission"]["limiting_margin_percent"] - best["mission"]["limiting_margin_percent"]
                parts.append(f"{o['strategy']} is feasible but its limiting margin differs by {d:+.1f} points.")
        return best["strategy"], " ".join(parts)
    least = min(routes, key=lambda r: (len(r["constraints_violated"]), -r["mission"]["limiting_margin_percent"]))
    return None, ("No route satisfies all modelled constraints. Closest: " + least["strategy"] +
                  f" (limiting factor {least['mission']['limiting_factor']}, margin {least['mission']['limiting_margin_percent']:.1f}%).")


def compare(routes: list[dict]) -> list[dict]:
    """Normalised components so the UI can show why alternatives differ."""
    keys = [("distance_km", "Distance (km)"), ("one_way_travel_hours", "One-way time (h)"),
            ("elevation_gain_m", "Ascent (m)"), ("max_slope_deg", "Max slope (°)")]
    rows = []
    for k, label in keys:
        vals = {r["strategy"]: (r["metrics"].get(k) or 0.0) for r in routes}
        hi = max(vals.values()) or 1.0
        rows.append({"metric": k, "label": label, "values": vals, "normalised": {s: v / hi for s, v in vals.items()}})
    en = {r["strategy"]: r["mission"]["energy_used_kwh"] for r in routes}
    hi = max(en.values()) or 1.0
    rows.append({"metric": "energy_used_kwh", "label": "Round-trip energy (kWh)", "values": en, "normalised": {s: v / hi for s, v in en.items()}})
    return rows


def request_hash(model) -> str:
    from ..scientific.risk import canon
    return hashlib.sha256(json.dumps(canon(model.model_dump()), sort_keys=True).encode()).hexdigest()[:16]


# --- long-range (strategic) planning ---------------------------------------------------------------------------------
LONG_RANGE_LIMITATIONS = [
    "Strategic overview: elevations are real MOLA values sampled every few kilometres (see grid spacing), not the full 463 m grid.",
    "At this spacing slopes are smoothed out: steep crater walls, scarps and every obstacle smaller than the spacing are invisible.",
    "Travel time, sols and consumables are estimates from editable assumptions; multi-sol operations (recharging, night, rest, resupply) are not modelled.",
    "Not a route a crew could follow. Plan each leg locally (≤ ~150 km) for terrain-evaluated detail. Nothing here is certified.",
]


def _pooled(z: np.ndarray, s: np.ndarray, max_size: int = 160) -> tuple[np.ndarray, np.ndarray, int]:
    f = max(1, math.ceil(max(z.shape) / max_size))
    if f == 1:
        return z, s, 1
    h, w = (z.shape[0] // f) * f, (z.shape[1] // f) * f
    zz = z[:h, :w].reshape(h // f, f, w // f, f).mean(axis=(1, 3))          # NaN propagates: any nodata keeps the cell missing
    with np.errstate(all="ignore"):
        ss = np.nanmean(s[:h, :w].reshape(h // f, f, w // f, f), axis=(1, 3))
    return zz, ss, f


def long_range(origin, dest, cfg) -> dict:
    a, b = (origin.lat, origin.lon), (dest.lat, dest.lon)
    try:
        g = mola_remote.fetch_coarse([a, b])
    except mola_remote.RemoteDemError as e:
        raise ApiError(_REMOTE_STATUS.get(e.code, 502), e.code, e.message, e.details) from e
    tile = dem.DemTile(meta={"id": f"coarse_{g['bounds_px']['row_off']}_{g['bounds_px']['col_off']}_{g['factor']}", "name": "MOLA long-range grid"},
                       z=g["z"], lon_left=g["lon_left"], lat_top=g["lat_top"], dlon=g["dlon"], dlat=g["dlat"])
    mob = Mobility.from_config(cfg)
    wraps = abs(((a[1] + 540) % 360 - 180) - ((b[1] + 540) % 360 - 180)) > 180     # the great circle would cross the 180° meridian
    routes = ([] if wraps else [public(shortest_route(tile, a, b, mob))]) + [public(optimised_route(tile, "terrain", a, b, mob))]
    zz, ss, pf = _pooled(tile.z, tile.slope_deg)
    h, w = zz.shape
    cell = lambda v: None if np.isnan(v) else round(float(v), 1)  # noqa: E731
    valid = ~np.isnan(tile.z)
    return {
        "mode": "long_range",
        "grid": {"spacing_m": tile.pixel_m, "factor": g["factor"], "source_pixel_m": g["source_pixel_m"], "rows": tile.rows, "cols": tile.cols,
                 "bounds": {"lat_min": tile.lat_bottom, "lat_max": tile.lat_top, "lon_min": tile.lon_left, "lon_max": tile.lon_right},
                 "valid_fraction": float(valid.mean()), "sampling": f"every {g['factor']}th MOLA cell in each direction (exact values, not averaged)",
                 "source": g["source"]},
        "routes": routes,
        "heightfield": {"tile_id": tile.id, "rows": h, "cols": w,
                        "bounds": {"lat_max": tile.lat_top, "lat_min": tile.lat_top - h * pf * tile.dlat, "lon_min": tile.lon_left, "lon_max": tile.lon_left + w * pf * tile.dlon},
                        "source_pixel_m": g["source_pixel_m"], "display_pixel_m": tile.pixel_m * pf,
                        "elevation_m": [cell(v) for v in zz.ravel()], "slope_deg": [cell(v) for v in ss.ravel()],
                        "notes": ["Display product of the long-range grid (block mean for display only)."]},
        "limitations": LONG_RANGE_LIMITATIONS + ([
            "The straight (great-circle) line between these points crosses the 180° meridian, which this grid does not wrap: only the "
            "terrain-aware route, which stays on the grid and goes the long way round, is shown."] if wraps else []),
        "certification": "NOT_CERTIFIABLE",
    }
