"""Bounded, DEM-aware route planning on a local MOLA window.

Four materially different objectives (see docs/SCIENTIFIC_VALIDATION.md):
  shortest   great-circle line sampled on the DEM; no optimisation, violations reported.
  terrain    A* minimising  d * (1 + (slope/s_ref)^2)  with a hard slope cap.
  resource   A* minimising normalised consumables (energy+O2+water) incl. slope-derated speed and climb.
  science    visits declared science stops (order optimised) with terrain-style legs; disabled
             (downgraded to terrain) when no stops are declared, because no science-value layer exists.
Missing data stays missing: a nodata cell is impassable and is reported, never filled.
Limits: all planning at 463 m grid; this cannot see rover-scale obstacles.
"""
from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass
from typing import Any

import numpy as np

from .dem import DemError, DemTile, profile_from_points
from .geodesy import haversine_km, interpolate_great_circle
from .mission import G_MARS, J_PER_KWH, slope_speed_factor, summarize_segments

MAX_GRID_CELLS = 180_000
STRATEGIES = ("shortest", "terrain", "resource", "science")
SQRT2 = math.sqrt(2)
NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


@dataclass(frozen=True)
class Mobility:
    max_slope_deg: float = 15.0
    slope_ref_deg: float = 8.0       # slope at which terrain-aware cost doubles
    speed_kmh: float = 4.5
    rover_mass_kg: float = 1500.0
    drivetrain_efficiency: float = 0.6
    baseline_kw: float = 1.2
    crew: int = 2
    o2_kg_per_person_hour: float = 0.084
    water_l_per_person_day: float = 2.5
    o2_capacity_kg: float = 18.0
    energy_capacity_kwh: float = 45.0
    water_capacity_l: float = 12.0
    return_required: bool = True

    @classmethod
    def from_config(cls, c) -> "Mobility":
        return cls(max_slope_deg=c.max_slope_deg, speed_kmh=c.speed_kmh, rover_mass_kg=c.rover_mass_kg,
                   drivetrain_efficiency=c.drivetrain_efficiency, baseline_kw=c.energy_kwh_per_hour, crew=c.crew,
                   o2_kg_per_person_hour=c.oxygen_kg_per_person_hour, water_l_per_person_day=c.water_liters_per_person_day,
                   o2_capacity_kg=c.oxygen_kg, energy_capacity_kwh=c.energy_kwh, water_capacity_l=c.water_liters,
                   return_required=c.return_required)


class RouteError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


def _edge_cost(objective: str, mob: Mobility, d: float, dz: float, step_slope: float, local_slope: float) -> float:
    if objective == "terrain":
        s = max(step_slope, local_slope)
        return d * (1 + (s / mob.slope_ref_deg) ** 2)
    if objective == "science":
        s = max(step_slope, local_slope)
        return d * (1 + (s / (mob.slope_ref_deg * 1.5)) ** 2)
    if objective == "resource":
        f = slope_speed_factor(step_slope, mob.max_slope_deg)
        hours = d / 1000 / (mob.speed_kmh * f)
        climb = abs(dz) if mob.return_required else max(dz, 0.0)
        kwh = hours * mob.baseline_kw + mob.rover_mass_kg * G_MARS * climb / mob.drivetrain_efficiency / J_PER_KWH
        cost = 0.0
        if mob.energy_capacity_kwh > 0: cost += kwh / mob.energy_capacity_kwh
        if mob.o2_capacity_kg > 0: cost += hours * mob.crew * mob.o2_kg_per_person_hour / mob.o2_capacity_kg
        if mob.water_capacity_l > 0: cost += hours / 24 * mob.crew * mob.water_l_per_person_day / mob.water_capacity_l
        return cost
    raise ValueError(objective)


def _min_unit_cost(objective: str, mob: Mobility) -> float:
    """Lower bound of cost per metre on flat ground (admissible A* heuristic scale)."""
    return _edge_cost(objective, mob, 1.0, 0.0, 0.0, 0.0)


def grid_path(tile: DemTile, start: tuple[float, float], goal: tuple[float, float], objective: str,
              mob: Mobility, blocked: np.ndarray | None = None) -> list[tuple[int, int]]:
    """Search inside a bounded corridor; widen the corridor (40 -> 120 -> 400 cells) before giving up."""
    last: RouteError | None = None
    for margin in (40, 120, 400):
        try:
            return _search(tile, start, goal, objective, mob, blocked, margin)
        except RouteError as e:
            if e.code not in ("no_traversable_route",):
                raise
            last = e
    assert last is not None
    raise last


def _search(tile: DemTile, start: tuple[float, float], goal: tuple[float, float], objective: str,
            mob: Mobility, blocked: np.ndarray | None, margin_cells: int) -> list[tuple[int, int]]:
    r0, c0 = tile.nearest_cell(*start)
    r1, c1 = tile.nearest_cell(*goal)
    for (r, c), what in (((r0, c0), "start"), ((r1, c1), "goal")):
        if np.isnan(tile.z[r, c]):
            raise RouteError("endpoint_nodata", f"The {what} cell has no elevation data.", {"cell": [r, c]})
        if blocked is not None and blocked[r, c]:
            raise RouteError("endpoint_blocked", f"The {what} cell lies inside an obstructed area.", {"cell": [r, c]})
    m = margin_cells
    while True:
        ra, rb = max(0, min(r0, r1) - m), min(tile.rows - 1, max(r0, r1) + m)
        ca, cb = max(0, min(c0, c1) - m), min(tile.cols - 1, max(c0, c1) + m)
        if (rb - ra + 1) * (cb - ca + 1) <= MAX_GRID_CELLS or m <= 2:
            break
        m //= 2
    if (rb - ra + 1) * (cb - ca + 1) > MAX_GRID_CELLS:
        raise RouteError("grid_too_large", "Origin and destination are too far apart for bounded planning.",
                         {"max_cells": MAX_GRID_CELLS})
    H, W = rb - ra + 1, cb - ca + 1
    z = tile.z[ra:rb + 1, ca:cb + 1].tolist()
    sl_arr = tile.slope_deg[ra:rb + 1, ca:cb + 1]
    ls = np.where(np.isnan(sl_arr), np.inf, sl_arr).tolist()   # unknown local slope is treated as impassable (never assumed flat)
    blk = blocked[ra:rb + 1, ca:cb + 1].tolist() if blocked is not None else None
    dxs = [tile.row_spacing_m(ra + r)[0] for r in range(H)]
    dy = tile.row_spacing_m(ra)[1]
    dx_min = min(dxs)
    h_scale = _min_unit_cost(objective, mob)
    gr, gc = r1 - ra, c1 - ca
    sr, sc = r0 - ra, c0 - ca
    INF = float("inf")
    g = [INF] * (H * W)
    parent = [-1] * (H * W)
    start_i, goal_i = sr * W + sc, gr * W + gc
    g[start_i] = 0.0
    heap = [(math.hypot((gc - sc) * dx_min, (gr - sr) * dy) * h_scale, 0.0, start_i)]
    closed = bytearray(H * W)
    max_slope = mob.max_slope_deg
    while heap:
        _, gcur, i = heapq.heappop(heap)
        if closed[i]:
            continue
        closed[i] = 1
        if i == goal_i:
            path = []
            while i != -1:
                path.append((ra + i // W, ca + i % W))
                i = parent[i]
            return path[::-1]
        r, c = divmod(i, W)
        zr = z[r][c]
        for dr, dc in NEIGHBOURS:
            rr, cc = r + dr, c + dc
            if rr < 0 or cc < 0 or rr >= H or cc >= W:
                continue
            j = rr * W + cc
            if closed[j]:
                continue
            zt = z[rr][cc]
            if zt != zt or (blk is not None and blk[rr][cc]):
                continue
            if ls[rr][cc] > max_slope and j != goal_i:   # local (Horn) slope is a hard cap too; endpoints exempt
                continue
            dxm = 0.5 * (dxs[r] + dxs[rr])
            d = math.hypot(dc * dxm, dr * dy)
            dz = zt - zr
            step_slope = math.degrees(math.atan2(abs(dz), d))
            if step_slope > max_slope:
                continue
            ng = gcur + _edge_cost(objective, mob, d, dz, step_slope, ls[rr][cc])
            if ng < g[j]:
                g[j] = ng
                parent[j] = i
                heapq.heappush(heap, (ng + math.hypot((gc - cc) * dx_min, (gr - rr) * dy) * h_scale, ng, j))
    raise RouteError("no_traversable_route",
                     "No route exists under the slope cap and data/obstruction constraints.",
                     {"max_slope_deg": max_slope})


def _cells_to_points(tile: DemTile, cells: list[tuple[int, int]]) -> list[tuple[float, float]]:
    return [tile.cell_center(r, c) for r, c in cells]


def _segments(tile: DemTile, pts: list[tuple[float, float]], z: list[float]) -> tuple[list[float], list[float]]:
    d = [haversine_km(*pts[i], *pts[i + 1]) * 1000 for i in range(len(pts) - 1)]
    dz = [z[i + 1] - z[i] for i in range(len(z) - 1)]
    return d, dz


def _finish(tile: DemTile, strategy: str, pts: list[tuple[float, float]], mob: Mobility, *, status: str = "ok",
            note: str | None = None, extra: dict | None = None, elev_from_profile: bool = False) -> dict[str, Any]:
    """Turn an ordered point list into a fully described route result."""
    prof = profile_from_points(tile, pts)
    samples = prof["samples"]
    z = [s["elevation_m"] for s in samples]
    d_all = [samples[i + 1]["distance_m"] - samples[i]["distance_m"] for i in range(len(samples) - 1)]
    valid = [(d, z[i + 1] - z[i]) for i, d in enumerate(d_all) if z[i] is not None and z[i + 1] is not None and d > 0]
    summary = summarize_segments([v[0] for v in valid], [v[1] for v in valid], mob.max_slope_deg)
    slopes = [s["along_track_slope_deg"] for s in samples if s["along_track_slope_deg"] is not None]
    over = [s for s in slopes if s > mob.max_slope_deg]
    local_over = [s["local_slope_deg"] for s in samples if s["local_slope_deg"] is not None and s["local_slope_deg"] > mob.max_slope_deg]
    violated: list[dict] = []
    if over or local_over:
        violated.append({"id": "max_slope", "detail": (
            f"{len(over)} along-track and {len(local_over)} local-slope samples exceed the {mob.max_slope_deg:.0f}° scenario limit "
            f"(max along-track {max(slopes, default=0):.1f}°)."), "count": len(over) + len(local_over)})
    gaps = prof["stats"]["nodata_samples"] + prof["stats"]["outside_coverage_samples"]
    if gaps:
        violated.append({"id": "data_gap", "detail": f"{gaps} samples lack elevation data.", "count": gaps})
    step = max(1, len(samples) // 400)
    keep = list(range(0, len(samples), step))
    if keep[-1] != len(samples) - 1:
        keep.append(len(samples) - 1)
    out = {
        "strategy": strategy, "status": status, "note": note,
        "coordinates": [{"lat": samples[i]["lat"], "lon": samples[i]["lon"], "elevation_m": samples[i]["elevation_m"]} for i in keep],
        "profile": {"distance_km": [samples[i]["distance_m"] / 1000 for i in keep],
                    "elevation_m": [samples[i]["elevation_m"] for i in keep],
                    "slope_deg": [samples[i]["along_track_slope_deg"] for i in keep],
                    "status": [samples[i]["status"] for i in keep]},
        "metrics": {
            "distance_km": prof["length_m"] / 1000, "one_way_travel_hours": summary.effective_km / mob.speed_kmh,
            "elevation_gain_m": prof["stats"]["gain_m"], "elevation_loss_m": prof["stats"]["loss_m"],
            "max_slope_deg": max(slopes, default=None), "mean_slope_deg": (sum(slopes) / len(slopes)) if slopes else None,
            "max_local_slope_deg": prof["stats"]["max_local_slope_deg"],
            "terrain_resolution_m": tile.pixel_m, "sample_spacing_m": prof["stats"]["sample_spacing_m"],
            "samples": len(samples), "interpolated_samples": prof["stats"]["interpolated_samples"],
            "nodata_samples": prof["stats"]["nodata_samples"], "outside_coverage_samples": prof["stats"]["outside_coverage_samples"],
            "effective_distance_km": summary.effective_km,
        },
        "constraints_violated": violated,
        "summary": {"one_way_km": summary.one_way_km, "effective_km": summary.effective_km,
                    "ascent_out_m": summary.ascent_out_m, "ascent_back_m": summary.ascent_back_m, "terrain_evaluated": True},
        "resolution": prof["resolution"], "tile_id": tile.id,
        "_summary_obj": summary, "_points": pts,
        "_dist_m": [v[0] for v in valid], "_dz_m": [v[1] for v in valid],
    }
    if extra:
        out.update(extra)
    return out


def _legs_cost_components(objective: str, mob: Mobility, tile: DemTile, route: dict) -> dict:
    m = route["metrics"]
    s = route["_summary_obj"]
    climb_kwh = mob.rover_mass_kg * G_MARS * (s.ascent_out_m + (s.ascent_back_m if mob.return_required else 0)) / mob.drivetrain_efficiency / J_PER_KWH
    comp = {"distance_km": m["distance_km"], "slope_derated_distance_km": s.effective_km,
            "one_way_travel_hours": m["one_way_travel_hours"], "round_trip_climb_energy_kwh": climb_kwh}
    if objective in ("terrain", "science"):
        ref = mob.slope_ref_deg * (1.5 if objective == "science" else 1.0)
        sl = [x for x in route["profile"]["slope_deg"] if x is not None]
        comp["slope_penalty_ratio"] = (sum((x / ref) ** 2 for x in sl) / len(sl)) if sl else 0.0
    return comp


def shortest_route(tile: DemTile, a: tuple[float, float], b: tuple[float, float], mob: Mobility) -> dict:
    n = max(1, math.ceil(haversine_km(*a, *b) * 1000 / tile.pixel_m))
    pts = interpolate_great_circle(*a, *b, n)
    r = _finish(tile, "shortest", pts, mob)
    r["cost_components"] = _legs_cost_components("shortest", mob, tile, r)
    r["objective"] = "Minimise geometric length (great circle). No terrain optimisation."
    return r


def optimised_route(tile: DemTile, strategy: str, a, b, mob: Mobility, *, stops: list[dict] | None = None,
                    blocked: np.ndarray | None = None) -> dict:
    objective = {"terrain": "terrain", "resource": "resource", "science": "science"}[strategy]
    note = None
    status = "ok"
    legs_pts: list[tuple[float, float]] = []
    stops = stops or []
    order: list[dict] = []
    if strategy == "science":
        if not stops:
            objective, status = "terrain", "downgraded"
            note = ("Science-prioritised planning needs declared science stops; no science-value dataset is available to "
                    "rank terrain automatically. Downgraded to the terrain-aware objective.")
        else:
            best = None
            for perm in itertools.permutations(range(len(stops))):
                pts = [a] + [(stops[i]["lat"], stops[i]["lon"]) for i in perm] + [b]
                length = sum(haversine_km(*pts[i], *pts[i + 1]) for i in range(len(pts) - 1))
                if best is None or length < best[0]:
                    best = (length, perm)
            order = [stops[i] for i in best[1]]
    waypoints = [a] + [(s["lat"], s["lon"]) for s in order] + [b]
    cells: list[tuple[int, int]] = []
    for u, v in zip(waypoints[:-1], waypoints[1:]):
        leg = grid_path(tile, u, v, objective, mob, blocked)
        cells.extend(leg if not cells else leg[1:])
    legs_pts = _cells_to_points(tile, cells)
    # exact endpoints are cell centres; keep them as the cell centres (no extrapolation to requested coords)
    r = _finish(tile, strategy, legs_pts, mob, status=status, note=note)
    r["cost_components"] = _legs_cost_components(objective, mob, tile, r)
    r["objective"] = {
        "terrain": "Minimise d·(1+(slope/slope_ref)²) with hard slope cap (cross-slope proxy = Horn slope at 463 m).",
        "resource": "Minimise normalised energy+oxygen+water use incl. slope-derated speed and climb energy.",
        "science": "Visit declared science stops (order minimising great-circle length), terrain-style legs.",
    }[objective if strategy != "science" or status == "ok" else "terrain"]
    if strategy == "science" and status == "ok":
        r["science_stops_visited"] = [{"name": s.get("name"), "lat": s["lat"], "lon": s["lon"], "dwell_hours": s.get("dwell_hours", 0.0),
                                       "weight": s.get("weight", 1.0)} for s in order]
    return r


def obstruction_mask(tile: DemTile, centre: tuple[float, float], radius_km: float) -> np.ndarray:
    rr, cc = np.indices(tile.z.shape)
    lat = tile.lat_top - (rr + 0.5) * tile.dlat
    lon = tile.lon_left + (cc + 0.5) * tile.dlon
    p1, p2 = np.radians(lat), math.radians(centre[0])
    dl = np.radians(lon - centre[1])
    h = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * math.cos(p2) * np.sin(dl / 2) ** 2
    dist_km = 2 * (tile.pixel_m / 1000 / math.radians(tile.dlat)) * np.arcsin(np.minimum(1, np.sqrt(h)))
    return dist_km <= radius_km


def route_error_to_dict(e: Exception) -> dict:
    if isinstance(e, (RouteError, DemError)):
        return {"code": e.code, "message": e.message, "details": e.details}
    raise e
