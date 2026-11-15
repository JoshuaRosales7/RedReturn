"""ARES: tool-based explanation layer. Every number comes from the deterministic engines.

`answer()` routes a question to calculation tools and returns text assembled from their outputs
(provenance "calculation"). An optional language model may paraphrase those facts; its text is
returned separately and labelled "language-model suggestion". The model never supplies numbers.
"""
from __future__ import annotations

import json
import logging
import os
import re

from ..scientific import emergency, risk
from ..scientific.mission import RouteSummary, evaluate
from ..scientific.routing import Mobility
from . import planning

log = logging.getLogger("redreturn.ares")
AI_RUNTIME_STATUS: dict[str, str] = {"state": "not_configured"}

INTENTS = [
    ("battery", r"batter|capacity|kwh|energy"),
    ("oxygen", r"oxyg|o2|o₂|air"),
    ("uncertainty", r"uncertain|sensitiv|assumption|which .*(matter|contribut)"),
    ("terrain_evidence", r"evidence|classif|terrain|slope|dem"),
    ("gaps", r"gap|lack|missing|data"),
    ("improve", r"improv|margin|increase|better|change"),
    ("certify", r"certif|safe|guarantee|approve"),
    ("why_route", r"why|prefer|recommend|best|route|choose"),
]


def _intent(q: str) -> str:
    q = q.lower()
    for name, pat in INTENTS:
        if re.search(pat, q):
            return name
    return "why_route"


def _pct(q: str, default: float) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", q)
    return float(m.group(1)) if m else default


def answer(req) -> dict:
    cfg = req.config
    alt = planning.alternatives(req.origin, req.destination, cfg, req.science_stops, ["shortest", "terrain", "resource", "science"])
    routes = {r["strategy"]: r for r in alt["routes"]}
    chosen = routes.get(req.strategy) or routes["terrain"]
    raw = planning.plan_cached(alt["tile"]["id"], req.strategy, (req.origin.lat, req.origin.lon),
                               (req.destination.lat, req.destination.lon), Mobility.from_config(cfg), planning.stops_key(req.science_stops))
    summary: RouteSummary = planning.summary_of(raw)
    cfg_r = planning.config_for(raw, cfg)
    m = evaluate(summary, cfg_r)
    intent = _intent(req.question)
    tools = ["route_alternatives", "mission_evaluate"]
    evidence: list[str] = []
    suggested: list[str] = []
    unc = ["463 m DEM: rover-scale hazards unresolved.", "Rates, speed derating and limits are assumptions."]

    if intent == "why_route":
        text = alt["reason"] if alt["recommended"] else alt["reason"]
        evidence = [f"{r['strategy']}: {r['metrics']['distance_km']:.1f} km, ascent {r['metrics']['elevation_gain_m']:.0f} m, max slope "
                    f"{(r['metrics']['max_slope_deg'] or 0):.1f}°, limiting {r['mission']['limiting_factor']} {r['mission']['limiting_margin_percent']:.1f}%"
                    for r in alt["routes"]]
        suggested = ["What if battery capacity drops by 25%?", "Which assumption contributes the most uncertainty?"]
    elif intent == "battery":
        pct = _pct(req.question, 25.0)
        tools.append("emergency_simulate")
        from ..models.schemas import Incident
        sim = emergency.simulate(_tile(alt), raw, cfg_r, Mobility.from_config(cfg_r), req.strategy, [Incident(kind="battery_loss", magnitude=pct)], 0.5,
                                 base=(req.origin.lat, req.origin.lon), dest=(req.destination.lat, req.destination.lon),
                                 science_hours=cfg_r.science_hours)
        rv = sim["revised"]
        f = sim["failure"]
        text = (f"A {pct:.0f}% battery capacity loss at the halfway point: continuing as planned gives limiting margin "
                f"{f['limiting_margin_percent']:.1f}% ({'feasible' if f['feasible_within_model'] else 'violates ' + ', '.join(k for k, v in f['constraints'].items() if not v)} within the model)." if f and f.get("status") == "ok"
                else "Continuing as planned is not possible.")
        if rv:
            text += (f" Best modelled option: {rv['label']} → limiting margin {rv['limiting_margin_percent']:.1f}%, "
                     f"{'feasible' if rv['feasible_within_model'] else 'still infeasible'} within the model.")
        evidence = sim["incident"]["applied"]
        suggested = ["Which option minimises remaining risk?", "How much extra energy would be needed?"]
    elif intent == "oxygen":
        tools.append("risk_analyze")
        rk = risk.analyze(summary, cfg_r, runs=1500, science_hours=cfg_r.science_hours, with_sensitivity=False)
        res = 1 - cfg.reserve_percent / 100
        det_need = m["oxygen_used_kg"] / res
        p90_used = cfg.oxygen_kg - rk["distributions"]["oxygen_remaining_kg"]["p10"]
        text = (f"Deterministic plan uses {m['oxygen_used_kg']:.2f} kg O₂ (incl. {cfg.contingency_percent:.0f}% contingency). To keep a {cfg.reserve_percent:.0f}% reserve "
                f"the loaded quantity must be ≥ {det_need:.2f} kg (you carry {cfg.oxygen_kg:.1f} kg). Under the ASSUMED input spread, the P90 usage is {p90_used:.2f} kg "
                f"→ ≥ {p90_used / res:.2f} kg loaded.")
        evidence = [f"Duration {m['duration_hours']:.1f} h × {cfg.crew} crew × {cfg.oxygen_kg_per_person_hour} kg/person/h × {1 + cfg.contingency_percent / 100:.2f}"]
        suggested = ["What if oxygen use rises 30%?"]
    elif intent == "uncertainty":
        tools.append("risk_analyze")
        rk = risk.analyze(summary, cfg_r, runs=2000, science_hours=cfg_r.science_hours)
        top = rk["sensitivity"][:3]
        text = ("Largest contributors to the limiting margin (swing between the P10 and P90 of each assumed input, others nominal): "
                + "; ".join(f"{s['label']} ({s['swing_percent_points']:.1f} pts, {s['kind']})" for s in top) + ". "
                + f"Fraction of simulated scenarios satisfying modelled constraints: {rk['fraction_satisfying_constraints'] * 100:.1f}% under assumed, not measured, distributions.")
        evidence = [f"{k}: spread {v['spread_percent_points']:.1f} pts" for k, v in rk["uncertainty_decomposition"].items()]
        suggested = ["Which assumption should I measure first?"]
    elif intent == "terrain_evidence":
        mt = chosen["metrics"]
        text = (f"Terrain evidence for {req.strategy}: elevations are MOLA 463 m DEM values (int16 m, MOLA areoid). Max along-track slope {(mt['max_slope_deg'] or 0):.1f}°, "
                f"max local (Horn) slope {(mt['max_local_slope_deg'] or 0):.1f}°, ascent {mt['elevation_gain_m']:.0f} m, descent {mt['elevation_loss_m']:.0f} m over {mt['distance_km']:.1f} km. "
                f"{mt['interpolated_samples']} of {mt['samples']} samples are bilinear interpolations. Features smaller than ~{2 * alt['tile']['pixel_size_m']:.0f} m are unresolved.")
        evidence = [alt["resolution"]["statement"]]
    elif intent == "gaps":
        mt = chosen["metrics"]
        gaps = mt["nodata_samples"] + mt["outside_coverage_samples"]
        text = (f"Data gaps on {req.strategy}: {gaps} of {mt['samples']} samples have no elevation. Not available at all in this build: rock/boulder abundance, "
                "high-resolution (HiRISE/CTX) terrain, soil bearing strength, local weather/radiation event data. Rover-scale obstacle avoidance is therefore not assessed anywhere along the route.")
        evidence = ["Dataset status: GET /api/datasets/status"]
    elif intent == "improve":
        text, evidence = _improve(summary, cfg_r, m)
        suggested = ["What changes the limiting factor?"]
    elif intent == "certify":
        text = ("RedReturn cannot certify this mission: (1) terrain is evaluated only at 463 m, so rover-scale hazards are unseen; (2) no rock/hazard dataset is integrated; "
                "(3) resource rates and limits are editable assumptions, not vehicle data; (4) Monte Carlo distributions are hypothetical, not validated probabilities; "
                "(5) no independent verification or crew/medical analysis exists. 'Feasible within the model' means only that the stated assumptions pass the stated constraints.")
        evidence = ["certification: NOT_CERTIFIABLE"]
    else:
        text = alt["reason"]

    out = {
        "answer": text, "provenance": "calculation", "intent": intent, "tools_used": tools, "evidence": evidence,
        "uncertainty": unc, "suggested_experiments": suggested,
        "route": {"strategy": req.strategy, "limiting_factor": m["limiting_factor"], "limiting_margin_percent": m["limiting_margin_percent"],
                  "feasible_within_model": m["feasible_within_model"]},
        "language_model": None,
    }
    if req.use_language_model:
        out["language_model"] = _llm(req.question, text, evidence)
    return out


def _tile(alt: dict):
    from ..scientific import dem
    return dem.all_tiles()[alt["tile"]["id"]]


def _improve(summary: RouteSummary, cfg, m: dict) -> tuple[str, list[str]]:
    base = m["limiting_margin_percent"]
    trials = {
        "Reduce science time by 50%": cfg.model_copy(update={"science_hours": cfg.science_hours * 0.5}),
        "Raise travel speed by 20%": cfg.model_copy(update={"speed_kmh": cfg.speed_kmh * 1.2}),
        "Carry 20% more oxygen, water and battery": cfg.model_copy(update={"oxygen_kg": cfg.oxygen_kg * 1.2, "water_liters": cfg.water_liters * 1.2, "energy_kwh": cfg.energy_kwh * 1.2}),
        "Extend the time window by 20%": cfg.model_copy(update={"max_hours": cfg.max_hours * 1.2}),
    }
    rows = []
    for label, c in trials.items():
        e = evaluate(summary, c)
        rows.append((label, e["limiting_margin_percent"] - base, e["limiting_factor"]))
    rows.sort(key=lambda r: -r[1])
    text = (f"Current limiting factor: {m['limiting_factor']} at {base:.1f}%. Modelled changes ranked by margin gain: "
            + "; ".join(f"{l} → {d:+.1f} pts (then limited by {f})" for l, d, f in rows) + ".")
    return text, [f"{l}: {d:+.1f} pts" for l, d, _ in rows]


def _llm(question: str, deterministic: str, evidence: list[str]) -> dict:
    """Optional paraphrase. Requires OPENAI_API_KEY and OPENAI_MODEL set server-side; never used for numbers."""
    global AI_RUNTIME_STATUS
    key, model = os.getenv("OPENAI_API_KEY"), os.getenv("OPENAI_MODEL")
    if not key or not model:
        AI_RUNTIME_STATUS = {"state": "not_configured"}
        return {"available": False, "label": "language-model suggestion", "text": None,
                "note": "Language model not configured; calculation-based answer above is complete."}
    try:
        from openai import OpenAI
        client = OpenAI(timeout=20, max_retries=1)
        resp = client.responses.create(model=model, store=False, input=[
            {"role": "system", "content": "You explain verified calculations for an educational Mars mission planner. Use ONLY the facts given. Never add numbers, never claim safety or certification."},
            {"role": "user", "content": json.dumps({"question": question, "verified_answer": deterministic, "evidence": evidence})}])
        AI_RUNTIME_STATUS = {"state": "ready", "model": model}
        return {"available": True, "label": "language-model suggestion", "text": resp.output_text, "model": model}
    except Exception as exc:  # noqa: BLE001 - calculator stays available
        AI_RUNTIME_STATUS = {"state": "error", "detail": type(exc).__name__}
        log.warning("language model unavailable: %s", type(exc).__name__)
        return {"available": False, "label": "language-model suggestion", "text": None, "note": "Language model call failed; calculation-based answer above is unaffected."}
