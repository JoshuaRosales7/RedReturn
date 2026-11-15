"""Deterministic mission resource model: the single authoritative calculation path.

Everything (point estimate, Monte Carlo, emergency re-planning) goes through
`project_mission`, written with numpy primitives so it works unchanged for
scalars and for arrays of Monte Carlo samples. The TypeScript mirror in
lib/mars.ts is verified against tests/golden/mission_vectors.json.

Assumption register (all editable, none measured for a specific mission):
* constant crew metabolic/life-support rates and baseline vehicle power;
* travel speed derated by slope: v = v0 * clamp(1 - slope/max_slope, 0.25, 1);
* climb energy = m * g_mars * ascent / drivetrain_efficiency, no regeneration;
* contingency multiplies projected future consumption;
* return trip retraces the outbound path (ascent/descent swap).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

G_MARS = 3.71  # m/s^2, standard surface gravity
J_PER_KWH = 3.6e6
SLOPE_SPEED_FLOOR = 0.25
CONSTRAINTS = ("oxygen", "energy", "water", "radiation", "time")


@dataclass(frozen=True)
class RouteSummary:
    """Aggregate of a one-way route. `effective_km` is slope-derated distance (km at nominal speed)."""
    one_way_km: float
    effective_km: float
    ascent_out_m: float = 0.0
    ascent_back_m: float = 0.0   # = descent on the outbound leg
    terrain_evaluated: bool = False


def slope_speed_factor(slope_deg: float, max_slope_deg: float) -> float:
    if max_slope_deg <= 0:
        return SLOPE_SPEED_FLOOR
    return float(min(1.0, max(SLOPE_SPEED_FLOOR, 1.0 - slope_deg / max_slope_deg)))


def summarize_segments(dist_m: list[float], dz_m: list[float], max_slope_deg: float,
                       terrain_evaluated: bool = True) -> RouteSummary:
    """Build a RouteSummary from per-segment horizontal distance and elevation change."""
    eff = asc = desc = 0.0
    total = 0.0
    for d, dz in zip(dist_m, dz_m):
        if d <= 0:
            continue
        slope = float(np.degrees(np.arctan2(abs(dz), d)))
        eff += d / slope_speed_factor(slope, max_slope_deg)
        total += d
        asc += max(dz, 0.0)
        desc += max(-dz, 0.0)
    return RouteSummary(total / 1000, eff / 1000, asc, desc, terrain_evaluated)


def flat_summary(one_way_km: float) -> RouteSummary:
    return RouteSummary(one_way_km, one_way_km, 0.0, 0.0, False)


@dataclass(frozen=True)
class State:
    """Consumables on board and what has already been consumed. Scalars or arrays."""
    oxygen_kg: Any
    energy_kwh: Any
    water_l: Any
    elapsed_h: Any = 0.0
    dose_msv: Any = 0.0


def params_from_config(c) -> dict[str, Any]:
    """Pull plain floats from a MissionConfig-like object (pydantic model or dict)."""
    get = (lambda k: c[k]) if isinstance(c, dict) else (lambda k: getattr(c, k))
    keys = ["crew", "speed_kmh", "oxygen_kg", "oxygen_kg_per_person_hour", "energy_kwh", "energy_kwh_per_hour",
            "water_liters", "water_liters_per_person_day", "radiation_msv_per_hour", "max_radiation_msv",
            "reserve_percent", "max_hours", "science_hours", "contingency_percent", "return_required",
            "max_slope_deg", "rover_mass_kg", "drivetrain_efficiency"]
    return {k: get(k) for k in keys}


def initial_state(p: dict[str, Any]) -> State:
    return State(p["oxygen_kg"], p["energy_kwh"], p["water_liters"])


def project_mission(state: State, route: RouteSummary, p: dict[str, Any], *, science_hours=None,
                    extra_delay_h=0.0, return_required=None, capacity: State | None = None) -> dict[str, Any]:
    """Project end-of-mission state from `state` over `route` (remaining legs, outbound-only count
    when return_required is false). `capacity` fixes reserve thresholds (default: current config)."""
    ret = p["return_required"] if return_required is None else return_required
    sci = p["science_hours"] if science_hours is None else science_hours
    legs = 2 if ret else 1
    distance_km = route.one_way_km * legs
    eff_km = route.effective_km * legs
    ascent_m = route.ascent_out_m + (route.ascent_back_m if ret else 0.0)
    speed = np.maximum(p["speed_kmh"], 0.1)
    travel_h = eff_km / speed
    duration_h = travel_h + sci + extra_delay_h
    factor = 1 + p["contingency_percent"] / 100
    climb_kwh = p["rover_mass_kg"] * G_MARS * ascent_m / np.maximum(p["drivetrain_efficiency"], 1e-3) / J_PER_KWH
    o2_used = duration_h * p["crew"] * p["oxygen_kg_per_person_hour"] * factor
    energy_used = (duration_h * p["energy_kwh_per_hour"] + climb_kwh) * factor
    water_used = duration_h / 24 * p["crew"] * p["water_liters_per_person_day"] * factor
    dose_future = duration_h * p["radiation_msv_per_hour"]
    cap = capacity or State(p["oxygen_kg"], p["energy_kwh"], p["water_liters"])
    o2_end, en_end, w_end = state.oxygen_kg - o2_used, state.energy_kwh - energy_used, state.water_l - water_used
    total_h = state.elapsed_h + duration_h
    dose = state.dose_msv + dose_future
    reserve = p["reserve_percent"] / 100
    res = {"oxygen": cap.oxygen_kg * reserve, "energy": cap.energy_kwh * reserve, "water": cap.water_l * reserve}
    ok = {
        "oxygen": o2_end >= res["oxygen"], "energy": en_end >= res["energy"], "water": w_end >= res["water"],
        "radiation": dose <= p["max_radiation_msv"], "time": total_h <= p["max_hours"],
    }

    def norm(rem, r, c):
        return np.where(c > 0, (rem - r) / np.where(c > 0, c, 1.0), -1.0)

    margins = {
        "oxygen": norm(o2_end, res["oxygen"], cap.oxygen_kg),
        "energy": norm(en_end, res["energy"], cap.energy_kwh),
        "water": norm(w_end, res["water"], cap.water_l),
        "time": (p["max_hours"] - total_h) / p["max_hours"],
        "radiation": (p["max_radiation_msv"] - dose) / p["max_radiation_msv"],
    }
    feasible = ok["oxygen"] & ok["energy"] & ok["water"] & ok["radiation"] & ok["time"]
    return {
        "distance_km": distance_km, "effective_km": eff_km, "ascent_m": ascent_m, "travel_hours": travel_h,
        "duration_hours": duration_h, "total_hours": total_h, "climb_kwh": climb_kwh,
        "oxygen_used_kg": o2_used, "energy_used_kwh": energy_used, "water_used_liters": water_used,
        "oxygen_remaining_kg": o2_end, "energy_remaining_kwh": en_end, "water_remaining_liters": w_end,
        "radiation_msv": dose, "reserves": res, "constraints": ok, "margins": margins,
        "feasible": feasible,
    }


def limiting_factor(margins: dict[str, float]) -> str:
    return min(margins, key=lambda k: margins[k])


def to_scalar(result: dict[str, Any]) -> dict[str, Any]:
    """Convert 0-d numpy values to Python scalars for JSON."""
    def conv(v):
        if isinstance(v, dict):
            return {k: conv(x) for k, x in v.items()}
        if isinstance(v, np.generic) or (isinstance(v, np.ndarray) and v.ndim == 0):
            return v.item()
        return v
    return conv(result)


def evaluate(route: RouteSummary, config) -> dict[str, Any]:
    """Point estimate for a planned round trip; returns the legacy contract plus margins."""
    p = params_from_config(config)
    r = to_scalar(project_mission(initial_state(p), route, p))
    margins = r["margins"]
    lim = limiting_factor(margins)
    return {
        "distance_km": r["distance_km"], "duration_hours": r["duration_hours"], "travel_hours": r["travel_hours"],
        "oxygen_used_kg": r["oxygen_used_kg"], "oxygen_remaining_kg": r["oxygen_remaining_kg"],
        "energy_used_kwh": r["energy_used_kwh"], "energy_remaining_kwh": r["energy_remaining_kwh"],
        "water_used_liters": r["water_used_liters"], "water_remaining_liters": r["water_remaining_liters"],
        "radiation_msv": r["radiation_msv"], "constraints": r["constraints"],
        "feasible_within_model": bool(r["feasible"]),
        "margins": margins, "limiting_factor": lim, "limiting_margin_percent": margins[lim] * 100,
        "effective_distance_km": r["effective_km"], "ascent_m": r["ascent_m"], "climb_energy_kwh": r["climb_kwh"],
        "terrain_status": "dem-evaluated-coarse" if route.terrain_evaluated else "insufficient-data",
        "certification": "NOT_CERTIFIABLE",
        "disclaimer": ("Educational planning estimate within stated assumptions; not medical, safety or "
                       "operational certification. Terrain-evaluated is not mission-safe."),
    }
