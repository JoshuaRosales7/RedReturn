"""Seeded Monte Carlo uncertainty and sensitivity analysis on top of the deterministic core.

IMPORTANT semantics: input distributions are HYPOTHETICAL scenario assumptions. The output
`fraction_satisfying_constraints` is the share of simulated scenarios that pass the modelled
constraints. It is not an empirically validated probability of mission success or crew survival.
"""
from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass

import numpy as np

from .mission import CONSTRAINTS, RouteSummary, State, params_from_config, project_mission

ENGINE_VERSION = "risk-1.0.0"


@dataclass(frozen=True)
class Dist:
    name: str
    label: str
    kind: str                 # measurement | model | scenario
    law: str                  # normal | lognormal | triangular
    sigma: float | None = None
    lo: float | None = None
    mode: float | None = None
    hi: float | None = None
    floor: float = 0.0
    cap: float | None = None
    rationale: str = ""


DEFAULT_DISTS: tuple[Dist, ...] = (
    Dist("speed_factor", "Travel speed", "model", "normal", sigma=0.15, floor=0.2,
         rationale="Soil, wheel slip and operations variability not captured by a constant nominal speed."),
    Dist("terrain_time_factor", "Unresolved terrain (travel-time penalty)", "measurement", "lognormal", sigma=0.10,
         rationale="DEM resolution is 463 m; sub-kilometre roughness lengthens real routes. Mean-1 lognormal on travel time."),
    Dist("climb_energy_factor", "Climb energy (DEM ascent bias)", "measurement", "lognormal", sigma=0.25,
         rationale="Ascent measured on a 463 m grid under-represents true ascent on rough terrain."),
    Dist("oxygen_rate_factor", "Oxygen consumption rate", "model", "normal", sigma=0.12, floor=0.5,
         rationale="Metabolic variation with workload; hypothetical spread."),
    Dist("energy_rate_factor", "Baseline power draw", "model", "normal", sigma=0.12, floor=0.5,
         rationale="Thermal/avionics load variation; hypothetical spread."),
    Dist("water_rate_factor", "Water consumption rate", "model", "normal", sigma=0.12, floor=0.5,
         rationale="Hypothetical spread."),
    Dist("radiation_factor", "Surface radiation rate", "measurement", "normal", sigma=0.25, floor=0.3,
         rationale="Rate anchored on published MSL RAD surface dose (≈0.64 mSv/day); event variability is assumed."),
    Dist("battery_capacity_factor", "Usable battery capacity", "model", "normal", sigma=0.05, floor=0.5, cap=1.0,
         rationale="Capacity fade/cold derating; cannot exceed nominal."),
    Dist("delay_hours", "Unplanned delay (h)", "scenario", "triangular", lo=0.0, mode=0.25, hi=2.0,
         rationale="Hypothetical operational delays (stops, replanning)."),
)


def _draw(rng: np.random.Generator, d: Dist, n: int, sigma: float | None) -> np.ndarray:
    s = d.sigma if sigma is None else sigma
    if d.law == "normal":
        x = 1 + rng.normal(0, s, n)
        x = np.maximum(x, d.floor)
        return np.minimum(x, d.cap) if d.cap is not None else x
    if d.law == "lognormal":
        return rng.lognormal(-0.5 * s * s, s, n)
    if d.law == "triangular":
        return rng.triangular(d.lo, d.mode, d.hi, n)
    raise ValueError(d.law)


def canon(o):
    """Canonical form for hashing: all numbers as floats (18 == 18.0), display `name` fields ignored."""
    if isinstance(o, bool):
        return o
    if isinstance(o, (int, float)):
        return float(o)
    if isinstance(o, dict):
        return {k: canon(v) for k, v in o.items() if k != "name"}
    if isinstance(o, (list, tuple)):
        return [canon(v) for v in o]
    return o


def _request_seed(payload: dict, seed: int) -> int:
    h = hashlib.sha256(json.dumps(canon(payload), sort_keys=True, default=str).encode()).hexdigest()
    return (int(h[:8], 16) ^ seed) & 0xFFFFFFFF


def _apply(p: dict, f: dict[str, np.ndarray | float]) -> dict:
    q = dict(p)
    q["speed_kmh"] = p["speed_kmh"] * f["speed_factor"]
    q["oxygen_kg_per_person_hour"] = p["oxygen_kg_per_person_hour"] * f["oxygen_rate_factor"]
    q["energy_kwh_per_hour"] = p["energy_kwh_per_hour"] * f["energy_rate_factor"]
    q["water_liters_per_person_day"] = p["water_liters_per_person_day"] * f["water_rate_factor"]
    q["radiation_msv_per_hour"] = p["radiation_msv_per_hour"] * f["radiation_factor"]
    return q


def _run(route: RouteSummary, p: dict, f: dict, science_hours: float) -> dict:
    q = _apply(p, f)
    # terrain time penalty scales slope-derated distance; DEM ascent bias scales climb energy via ascent_m
    r2 = RouteSummary(route.one_way_km, route.effective_km * f["terrain_time_factor"],
                      route.ascent_out_m * f["climb_energy_factor"], route.ascent_back_m * f["climb_energy_factor"],
                      route.terrain_evaluated)
    cap = State(p["oxygen_kg"], p["energy_kwh"], p["water_liters"])
    start = State(p["oxygen_kg"], p["energy_kwh"] * f["battery_capacity_factor"], p["water_liters"])
    return project_mission(start, r2, q, science_hours=science_hours, extra_delay_h=f["delay_hours"], capacity=cap)


def _wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    ph = k / n
    den = 1 + z * z / n
    c = (ph + z * z / (2 * n)) / den
    h = z * math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den
    return (max(0.0, c - h), min(1.0, c + h))


def _quant(x: np.ndarray) -> dict:
    p10, p50, p90 = np.quantile(x, [0.1, 0.5, 0.9])
    return {"p10": float(p10), "p50": float(p50), "p90": float(p90)}


def _rank(x: np.ndarray) -> np.ndarray:
    return np.argsort(np.argsort(x)).astype(float)


def analyze(route: RouteSummary, config, *, runs: int = 2000, seed: int = 20261114, science_hours: float | None = None,
            sigma_overrides: dict[str, float] | None = None, active_kinds: set[str] | None = None,
            request_payload: dict | None = None, with_sensitivity: bool = True) -> dict:
    p = params_from_config(config)
    sci = p["science_hours"] if science_hours is None else science_hours
    rng = np.random.default_rng(_request_seed(request_payload or {"p": p, "r": route.__dict__, "s": sci}, seed))
    overrides = sigma_overrides or {}
    active_kinds = active_kinds or {"measurement", "model", "scenario"}
    f: dict[str, np.ndarray | float] = {}
    for d in DEFAULT_DISTS:
        if d.kind in active_kinds:
            f[d.name] = _draw(rng, d, runs, overrides.get(d.name))
        else:
            f[d.name] = np.zeros(runs) if d.name == "delay_hours" else np.ones(runs)
    res = _run(route, p, f, sci)
    margins = np.stack([res["margins"][k] for k in CONSTRAINTS], axis=1)
    min_margin = margins.min(axis=1)
    feasible = res["feasible"]
    n_ok = int(feasible.sum())
    lo, hi = _wilson(n_ok, runs)
    constraint_pass = {k: float(res["constraints"][k].mean()) for k in CONSTRAINTS}
    fail = ~feasible
    dominant = {k: 0 for k in CONSTRAINTS}
    if fail.any():
        worst = np.argmin(margins[fail], axis=1)
        for i, k in enumerate(CONSTRAINTS):
            dominant[k] = int((worst == i).sum())
    out: dict = {
        "kind": "hypothetical-scenario-ensemble",
        "label": ("Fraction of simulated scenarios satisfying modelled constraints under ASSUMED input distributions. "
                  "This is NOT an empirically validated probability of mission success or crew survival."),
        "runs": runs, "seed": seed,
        "fraction_satisfying_constraints": n_ok / runs,
        "monte_carlo_sampling_interval_95": {"low": lo, "high": hi, "method": "Wilson score; sampling error only, excludes model error"},
        "constraint_pass_fraction": constraint_pass,
        "dominant_failure_mode_counts": dominant,
        "dominant_failure_mode": max(dominant, key=lambda k: dominant[k]) if fail.any() else None,
        "distributions": {
            "duration_hours": _quant(res["total_hours"]),
            "oxygen_remaining_kg": _quant(res["oxygen_remaining_kg"]),
            "energy_remaining_kwh": _quant(res["energy_remaining_kwh"]),
            "water_remaining_liters": _quant(res["water_remaining_liters"]),
            "radiation_msv": _quant(res["radiation_msv"]),
            "limiting_margin_percent": {k: v * 100 for k, v in _quant(min_margin).items()},
        },
        "margin_histogram": _hist(min_margin * 100),
        "assumptions": [{"name": d.name, "label": d.label, "kind": d.kind, "law": d.law,
                         "sigma": overrides.get(d.name, d.sigma), "lo": d.lo, "mode": d.mode, "hi": d.hi,
                         "rationale": d.rationale} for d in DEFAULT_DISTS],
        "engine": {"version": ENGINE_VERSION, "numpy": np.__version__, "rng": "numpy.default_rng(PCG64)"},
    }
    if with_sensitivity:
        out["sensitivity"] = _sensitivity(route, p, sci, f, min_margin)
        out["uncertainty_decomposition"] = _decompose(route, config, runs, seed, sci, overrides, request_payload)
    digest = hashlib.sha256(json.dumps({k: v for k, v in out.items() if k != "engine"}, sort_keys=True, default=str).encode()).hexdigest()
    out["result_sha256"] = digest
    return out


def _hist(x: np.ndarray, bins: int = 24) -> dict:
    counts, edges = np.histogram(x, bins=bins)
    return {"edges": [float(e) for e in edges], "counts": [int(c) for c in counts]}


def _nominal() -> dict:
    return {d.name: 0.0 if d.name == "delay_hours" else 1.0 for d in DEFAULT_DISTS}


def _sensitivity(route, p, sci, f, base_margin) -> list[dict]:
    rows = []
    rbase = _rank(base_margin)
    nominal = _nominal()
    for d in DEFAULT_DISTS:
        x = f[d.name]
        if np.ptp(x) == 0:
            continue
        rho = float(np.corrcoef(_rank(x), rbase)[0, 1])
        lo, hi = np.quantile(x, [0.1, 0.9])
        out = []
        for v in (lo, hi):
            ff = {k: np.array([val]) for k, val in nominal.items()}
            ff[d.name] = np.array([v])
            r = _run(route, p, ff, sci)
            out.append(float(min(r["margins"][k][0] for k in CONSTRAINTS) * 100))
        rows.append({"name": d.name, "label": d.label, "kind": d.kind, "spearman_rho": rho,
                     "margin_at_p10_input": out[0], "margin_at_p90_input": out[1], "swing_percent_points": abs(out[1] - out[0]),
                     "input_p10": float(lo), "input_p90": float(hi)})
    rows.sort(key=lambda r: -r["swing_percent_points"])
    return rows


def _decompose(route, config, runs, seed, sci, overrides, payload) -> dict:
    """Spread of the limiting margin when only one class of uncertainty is active."""
    res = {}
    for kind in ("measurement", "model", "scenario"):
        r = analyze(route, config, runs=min(runs, 2000), seed=seed, science_hours=sci, sigma_overrides=overrides,
                    active_kinds={kind}, request_payload=payload, with_sensitivity=False)
        q = r["distributions"]["limiting_margin_percent"]
        res[kind] = {"margin_p10": q["p10"], "margin_p90": q["p90"], "spread_percent_points": q["p90"] - q["p10"]}
    return res
