"""Emergency / return-to-base scenario engine.

Compares ORIGINAL (nominal plan) vs FAILURE (plan continued under the incident) vs REVISED
(best model-feasible option after replanning). All numbers come from `project_mission`.
Research and education prototype; this is NOT operational emergency guidance.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Any

from .dem import DemTile
from .mission import (CONSTRAINTS, RouteSummary, State, initial_state, limiting_factor, params_from_config,
                      project_mission, summarize_segments, to_scalar)
from .routing import Mobility, RouteError, obstruction_mask, optimised_route

COMMS_DELAY_H_PER_100_PERCENT = 1.0   # ASSUMPTION: linear operational-delay proxy; no comms physics in the model


def _reverse(s: RouteSummary) -> RouteSummary:
    return replace(s, ascent_out_m=s.ascent_back_m, ascent_back_m=s.ascent_out_m)


def _add(*parts: RouteSummary) -> RouteSummary:
    return RouteSummary(sum(x.one_way_km for x in parts), sum(x.effective_km for x in parts),
                        sum(x.ascent_out_m for x in parts), sum(x.ascent_back_m for x in parts), True)


def _split(route: dict, progress: float, max_slope: float) -> tuple[int, RouteSummary, RouteSummary, tuple[float, float]]:
    """Summaries of traveled and remaining parts of the outbound route at `progress` (0..1)."""
    d, dz = route["_dist_m"], route["_dz_m"]
    total = sum(d)
    target = progress * total
    acc, k = 0.0, 0
    while k < len(d) and acc + d[k] <= target + 1e-9:
        acc += d[k]
        k += 1
    done = summarize_segments(d[:k], dz[:k], max_slope) if k else RouteSummary(0, 0, 0, 0, True)
    rest = summarize_segments(d[k:], dz[k:], max_slope) if k < len(d) else RouteSummary(0, 0, 0, 0, True)
    pts = route["_points"]
    # points correspond to segment ends only when no gaps were skipped; clamp index defensively
    pos = pts[min(k, len(pts) - 1)]
    return k, done, rest, pos


def _deficits(res: dict, p: dict, cap: State) -> dict:
    res = to_scalar(res)
    rsv = res["reserves"]
    return {
        "oxygen_kg": max(0.0, rsv["oxygen"] - res["oxygen_remaining_kg"]),
        "energy_kwh": max(0.0, rsv["energy"] - res["energy_remaining_kwh"]),
        "water_l": max(0.0, rsv["water"] - res["water_remaining_liters"]),
        "time_h": max(0.0, res["total_hours"] - p["max_hours"]),
        "radiation_msv": max(0.0, res["radiation_msv"] - p["max_radiation_msv"]),
    }


def _describe(name: str, label: str, res: dict, p: dict, cap: State, extra: dict | None = None) -> dict:
    r = to_scalar(res)
    m = r["margins"]
    lim = limiting_factor(m)
    out = {
        "id": name, "label": label, "feasible_within_model": bool(r["feasible"]), "status": "ok",
        "total_hours": r["total_hours"], "remaining_distance_km": r["distance_km"],
        "oxygen_remaining_kg": r["oxygen_remaining_kg"], "energy_remaining_kwh": r["energy_remaining_kwh"],
        "water_remaining_liters": r["water_remaining_liters"], "radiation_msv": r["radiation_msv"],
        "constraints": r["constraints"], "margins_percent": {k: v * 100 for k, v in m.items()},
        "limiting_factor": lim, "limiting_margin_percent": m[lim] * 100,
        "exhausted": [k for k, v in (("oxygen", r["oxygen_remaining_kg"]), ("energy", r["energy_remaining_kwh"]),
                                    ("water", r["water_remaining_liters"])) if v < 0],
        "required_additional": _deficits(res, p, cap),
    }
    if extra:
        out.update(extra)
    return out


def _blocked_option(name: str, label: str, why: str) -> dict:
    return {"id": name, "label": label, "feasible_within_model": False, "status": "blocked", "reason": why}


def simulate(tile: DemTile, route: dict, config, mob: Mobility, strategy: str, incidents: list, progress: float,
             science_stops: list[dict] | None = None, base: tuple[float, float] | None = None,
             dest: tuple[float, float] | None = None, science_hours: float | None = None) -> dict[str, Any]:
    p = params_from_config(config)
    cap = State(p["oxygen_kg"], p["energy_kwh"], p["water_liters"])
    sci = p["science_hours"] if science_hours is None else science_hours
    full = route["_summary_obj"]
    original = project_mission(initial_state(p), full, p, science_hours=sci, capacity=cap)

    k, done, rest, pos = _split(route, progress, p["max_slope_deg"])
    # Consumption so far uses the same contingency factor as the original plan, so a zero-magnitude
    # incident reproduces the original mission exactly (apples-to-apples comparison).
    used = project_mission(initial_state(p), done, p, science_hours=0.0, return_required=False, capacity=cap)
    used = to_scalar(used)
    state = State(p["oxygen_kg"] - used["oxygen_used_kg"], p["energy_kwh"] - used["energy_used_kwh"],
                  p["water_liters"] - used["water_used_liters"], used["duration_hours"], used["radiation_msv"])

    # --- apply incidents -------------------------------------------------------------------
    q = dict(p)
    sci_after = sci
    extra_delay = 0.0
    obstruction: dict | None = None
    applied: list[str] = []
    for inc in incidents:
        m = inc.magnitude if hasattr(inc, "magnitude") else inc["magnitude"]
        kind = inc.kind if hasattr(inc, "kind") else inc["kind"]
        if kind == "battery_loss":
            new_cap = p["energy_kwh"] * (1 - min(m, 100) / 100)
            state = replace(state, energy_kwh=max(0.0, new_cap - used["energy_used_kwh"]))
            applied.append(f"Usable battery capacity reduced {m:.0f}% ({p['energy_kwh']:.1f} → {new_cap:.1f} kWh); reserve threshold kept at the original capacity (conservative).")
        elif kind == "speed_reduction":
            q["speed_kmh"] = q["speed_kmh"] * (1 - min(m, 95) / 100)
            applied.append(f"Rover speed reduced {m:.0f}% to {q['speed_kmh']:.2f} km/h.")
        elif kind == "oxygen_increase":
            q["oxygen_kg_per_person_hour"] *= 1 + m / 100
            applied.append(f"Oxygen consumption rate +{m:.0f}% for the remainder.")
        elif kind == "water_loss":
            lost = p["water_liters"] * min(m, 100) / 100
            state = replace(state, water_l=max(0.0, state.water_l - lost))
            applied.append(f"Water supply reduced by {lost:.1f} L ({m:.0f}% of initial capacity).")
        elif kind == "extended_science":
            sci_after += m
            applied.append(f"Science operations extended by {m:.1f} h.")
        elif kind == "travel_delay":
            extra_delay += m
            applied.append(f"Unexpected travel delay of {m:.1f} h.")
        elif kind == "comms_reduction":
            d = COMMS_DELAY_H_PER_100_PERCENT * m / 100
            extra_delay += d
            applied.append(f"Communication availability reduced {m:.0f}%: ASSUMPTION adds {d:.2f} h of operational delay (the model has no communications physics).")
        elif kind == "route_obstruction":
            obstruction = {"radius_km": m}
    rest_points = route["_points"][k:]
    block = None
    if obstruction is not None and len(route["_points"]) > 1:
        ahead = route["_points"][min(len(route["_points"]) - 1, k + max(3, int(0.08 * len(route["_points"]))))]
        block = obstruction_mask(tile, ahead, obstruction["radius_km"])
        obstruction["centre"] = {"lat": ahead[0], "lon": ahead[1]}
        applied.append(f"Route segment obstructed within {obstruction['radius_km']:.1f} km of ({ahead[0]:.3f}°, {ahead[1]:.3f}°); cells treated as impassable.")
    planned_blocked = False
    if block is not None:
        for lat, lon in rest_points:
            r, c = tile.nearest_cell(lat, lon)
            if block[r, c]:
                planned_blocked = True
                break

    cap_for_state = cap
    options: list[dict] = []
    here = pos
    outbound_done = progress >= 1.0 - 1e-9

    # 1 continue as planned (= FAILURE scenario)
    if planned_blocked:
        options.append(_blocked_option("continue_as_planned", "Continue as planned", "The planned path crosses the obstruction."))
    else:
        rem = _add(rest, _reverse(full))
        res = project_mission(state, rem, q, science_hours=sci_after, extra_delay_h=extra_delay, return_required=False, capacity=cap_for_state)
        options.append(_describe("continue_as_planned", "Continue as planned", res, q, cap))

    # 2 continue to destination around obstruction
    new_out_summary = None
    if planned_blocked and dest is not None:
        try:
            alt = optimised_route(tile, "terrain" if strategy in ("shortest", "science") else strategy, here, dest, mob, blocked=block)
            new_out_summary = alt["_summary_obj"]
            rem = _add(new_out_summary, _reverse(_add(done, new_out_summary)))
            res = project_mission(state, rem, q, science_hours=sci_after, extra_delay_h=extra_delay, return_required=False, capacity=cap)
            options.append(_describe("continue_replanned", "Continue to target around obstruction", res, q, cap,
                                     {"route_distance_km": alt["metrics"]["distance_km"], "route_max_slope_deg": alt["metrics"]["max_slope_deg"]}))
        except RouteError as e:
            options.append(_blocked_option("continue_replanned", "Continue to target around obstruction", e.message))

    # 3 continue but skip science
    if not outbound_done or sci_after > 0:
        if planned_blocked and new_out_summary is not None:
            rem = _add(new_out_summary, _reverse(_add(done, new_out_summary)))
        elif planned_blocked:
            rem = None
        else:
            rem = _add(rest, _reverse(full))
        if rem is not None:
            res = project_mission(state, rem, q, science_hours=0.0, extra_delay_h=extra_delay, return_required=False, capacity=cap)
            options.append(_describe("continue_skip_science", "Continue, skip science stay", res, q, cap))

    # 4 abort to base now (best of resource / terrain replans)
    if base is not None:
        best = None
        for obj in ("resource", "terrain"):
            try:
                alt = optimised_route(tile, obj, here, base, mob, blocked=block)
            except RouteError:
                continue
            res = project_mission(state, alt["_summary_obj"], q, science_hours=0.0, extra_delay_h=extra_delay, return_required=False, capacity=cap)
            d = _describe("abort_to_base", "Abort now and return to base", res, q, cap,
                          {"route_objective": obj, "route_distance_km": alt["metrics"]["distance_km"],
                           "route_max_slope_deg": alt["metrics"]["max_slope_deg"]})
            if best is None or d["limiting_margin_percent"] > best["limiting_margin_percent"]:
                best = d
        options.append(best or _blocked_option("abort_to_base", "Abort now and return to base", "No traversable path to base under the constraints."))

    ok = [o for o in options if o.get("status") == "ok"]
    feasible = [o for o in ok if o["feasible_within_model"]]
    if feasible:
        revised = max(feasible, key=lambda o: (o["limiting_margin_percent"], -o["total_hours"]))
        revised_feasible = True
    elif ok:
        revised = min(ok, key=_deficit_score)
        revised_feasible = False
    else:
        revised, revised_feasible = None, False

    failure = next((o for o in options if o["id"] in ("continue_as_planned",)), None)
    orig_desc = _describe("original", "Original mission", original, p, cap, {"total_hours": float(to_scalar(original)["total_hours"])})
    diff = _diff(orig_desc, failure, revised)
    levers = _levers(state, rest, full, q, sci_after, extra_delay, cap, failure, planned_blocked)
    return {
        "disclaimer": "Research and education decision-support prototype; not operational emergency guidance.",
        "incident": {"progress": progress, "position": {"lat": here[0], "lon": here[1]}, "applied": applied,
                     "elapsed_hours": used["duration_hours"], "obstruction": obstruction},
        "state_at_incident": {"oxygen_kg": float(state.oxygen_kg), "energy_kwh": float(state.energy_kwh), "water_l": float(state.water_l),
                              "elapsed_h": float(state.elapsed_h), "dose_msv": float(state.dose_msv)},
        "original": orig_desc, "failure": failure, "options": options, "revised": revised, "revised_feasible": revised_feasible,
        "diff": diff, "contingency_levers": levers,
        "unavoidable_uncertainty": [
            "Elevation is a 463 m grid: rover-scale obstacles and slopes are not resolved, so any route may be impassable in reality.",
            "Consumption rates, speed and the slope-derating law are assumptions, not vehicle measurements.",
            "Incident magnitudes are user-defined what-ifs; their likelihood is unknown.",
            "A model-feasible option is not a safe or certified option.",
        ],
    }


def _deficit_score(o: dict) -> float:
    d = o["required_additional"]
    return d["oxygen_kg"] + d["energy_kwh"] + d["water_l"] + d["time_h"] + d["radiation_msv"]


def _diff(orig: dict, failure: dict | None, revised: dict | None) -> list[dict]:
    rows = []
    def pick(o, k): return None if not o or o.get("status") != "ok" and k != "feasible_within_model" else o.get(k)
    specs = [
        ("Total mission time (h)", "total_hours", "Incident delay/slow speed and any rerouting change elapsed time."),
        ("Oxygen remaining at base (kg)", "oxygen_remaining_kg", "Rate × remaining time; shorter returns preserve oxygen."),
        ("Energy remaining at base (kWh)", "energy_remaining_kwh", "Capacity loss plus baseline power × time plus climb energy."),
        ("Water remaining at base (L)", "water_remaining_liters", "Water loss and remaining duration."),
        ("Radiation dose (mSv)", "radiation_msv", "Constant-rate scenario × total time."),
        ("Limiting margin (%)", "limiting_margin_percent", "Smallest normalised margin across constraints."),
        ("Feasible within model", "feasible_within_model", "All reserve, time and dose constraints satisfied."),
    ]
    for label, key, cause in specs:
        rows.append({"metric": label, "original": pick(orig, key), "failure": pick(failure, key), "revised": pick(revised, key), "cause": cause})
    return rows


def _levers(state, rest, full, q, sci, delay, cap, failure, blocked) -> list[dict]:
    if blocked or failure is None or failure.get("status") != "ok":
        return []
    base_rem = _add(rest, _reverse(full))
    base = project_mission(state, base_rem, q, science_hours=sci, extra_delay_h=delay, return_required=False, capacity=cap)
    base_m = min(float(base["margins"][k]) for k in CONSTRAINTS) * 100
    out = []
    def eff(name, desc, res):
        m = min(float(res["margins"][k]) for k in CONSTRAINTS) * 100
        out.append({"id": name, "action": desc, "limiting_margin_percent": m, "delta_percent_points": m - base_m,
                    "feasible_within_model": bool(res["feasible"]), "basis": "model calculation"})
    eff("skip_science", "Skip the remaining science stay", project_mission(state, base_rem, q, science_hours=0.0, extra_delay_h=delay, return_required=False, capacity=cap))
    q2 = dict(q, energy_kwh_per_hour=q["energy_kwh_per_hour"] * 0.8)
    eff("shed_load", "Shed 20% of baseline electrical load (scenario lever, achievability unverified)", project_mission(state, base_rem, q2, science_hours=sci, extra_delay_h=delay, return_required=False, capacity=cap))
    if delay > 0:
        eff("no_delay", "Recover the unplanned delay (no further delay)", project_mission(state, base_rem, q, science_hours=sci, extra_delay_h=0.0, return_required=False, capacity=cap))
    return out
