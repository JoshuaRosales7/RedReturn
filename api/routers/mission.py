from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from ..datasets import registry
from ..errors import ApiError
from ..models.schemas import (MissionRequest, ReportRequest, RiskRequest, ScenarioRequest, SimulationRequest)
from ..scientific import dem, emergency, risk
from ..scientific.mission import evaluate, flat_summary
from ..scientific.routing import Mobility
from ..services import planning

router = APIRouter(tags=["mission"])


def _legacy_summary(route):
    return flat_summary(route.distance_km)


@router.post("/api/mission/evaluate")
def mission_evaluate(req: MissionRequest):
    return evaluate(_legacy_summary(req.route), req.config)


@router.post("/api/mission/simulate")
def mission_simulate(req: SimulationRequest):
    result = evaluate(_legacy_summary(req.route), req.config)
    n = req.steps - 1
    c = req.config
    return {"summary": result, "timeline": [{"fraction": i / n, "hours": result["duration_hours"] * i / n,
                                            "oxygen_remaining_kg": c.oxygen_kg - result["oxygen_used_kg"] * i / n,
                                            "energy_remaining_kwh": c.energy_kwh - result["energy_used_kwh"] * i / n} for i in range(req.steps)]}


def _planned(origin, dest, strategy, cfg, stops):
    a, b = (origin.lat, origin.lon), (dest.lat, dest.lon)
    tile = planning.require_tile([a, b])
    raw = planning.plan_cached(tile.id, strategy, a, b, Mobility.from_config(cfg), planning.stops_key(stops))
    return tile, raw, planning.config_for(raw, cfg)


@router.post("/api/risk/analyze")
def risk_analyze(req: RiskRequest):
    tile, raw, cfg = _planned(req.origin, req.destination, req.strategy, req.config, req.science_stops)
    overrides = {o.name: o.sigma for o in req.overrides if o.sigma is not None}
    unknown = set(overrides) - {d.name for d in risk.DEFAULT_DISTS}
    if unknown:
        raise ApiError(422, "unknown_uncertainty", "Unknown uncertainty input.", {"unknown": sorted(unknown), "known": [d.name for d in risk.DEFAULT_DISTS]})
    payload = req.model_dump()
    out = risk.analyze(planning.summary_of(raw), cfg, runs=req.runs, seed=req.seed, science_hours=cfg.science_hours,
                       sigma_overrides=overrides, request_payload=payload)
    out["route"] = {"strategy": raw["strategy"], "status": raw["status"], "distance_km": raw["metrics"]["distance_km"],
                    "terrain_evaluated": True, "tile_id": tile.id}
    out["deterministic"] = evaluate(planning.summary_of(raw), cfg)
    out["request_sha256"] = planning.request_hash(req)
    return out


@router.post("/api/scenarios/simulate")
def scenario_simulate(req: ScenarioRequest):
    tile, raw, cfg = _planned(req.origin, req.destination, req.strategy, req.config, req.science_stops)
    out = emergency.simulate(tile, raw, cfg, Mobility.from_config(cfg), req.strategy, req.incidents, req.at_progress,
                             base=(req.origin.lat, req.origin.lon), dest=(req.destination.lat, req.destination.lon),
                             science_hours=cfg.science_hours)
    out["planned_route"] = planning.public(raw) | {"mission": evaluate(planning.summary_of(raw), cfg)}
    # alternatives that remain viable from the original base (what-if comparison)
    return out


def _geojson(alt: dict, req: ReportRequest) -> dict:
    feats = []
    for r in alt["routes"]:
        feats.append({"type": "Feature",
                      "geometry": {"type": "LineString", "coordinates": [[c["lon"], c["lat"], c["elevation_m"]] if c["elevation_m"] is not None else [c["lon"], c["lat"]] for c in r["coordinates"]]},
                      "properties": {"strategy": r["strategy"], "status": r["status"], "distance_km": r["metrics"]["distance_km"],
                                     "max_slope_deg": r["metrics"]["max_slope_deg"], "elevation_gain_m": r["metrics"]["elevation_gain_m"],
                                     "feasible_within_model": r["mission"]["feasible_within_model"], "recommended": r["strategy"] == alt["recommended"],
                                     "elevation_note": "metres above MOLA areoid (not WGS84)"}})
    for name, c in (("origin", req.origin), ("destination", req.destination)):
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [((c.lon + 540) % 360) - 180, c.lat]}, "properties": {"role": name, "name": c.name}})
    for s in req.science_stops:
        feats.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [((s.lon + 540) % 360) - 180, s.lat]}, "properties": {"role": "science_stop", "name": s.name, "dwell_hours": s.dwell_hours}})
    return {"type": "FeatureCollection", "features": feats,
            "properties": {"generator": "RedReturn", "crs_note": "Mars planetocentric, east-positive longitude", "disclaimer": planning.LIMITATIONS[-1]}}


@router.post("/api/reports/geojson")
def report_geojson(req: ReportRequest):
    alt = planning.alternatives(req.origin, req.destination, req.config, req.science_stops, ["shortest", "terrain", "resource", "science"])
    return _geojson(alt, req)


@router.post("/api/reports/json")
def report_json(req: ReportRequest):
    alt = planning.alternatives(req.origin, req.destination, req.config, req.science_stops, ["shortest", "terrain", "resource", "science"])
    strategy = req.strategy or alt["recommended"] or "terrain"
    tile, raw, cfg = _planned(req.origin, req.destination, strategy, req.config, req.science_stops)
    rk = risk.analyze(planning.summary_of(raw), cfg, runs=req.runs, seed=req.seed, science_hours=cfg.science_hours,
                      request_payload={"report": req.model_dump(), "strategy": strategy})
    scenario = None
    incidents = req.incidents or ([req.incident] if req.incident is not None else [])
    if incidents:
        scenario = emergency.simulate(tile, raw, cfg, Mobility.from_config(cfg), strategy, incidents, req.incident_progress,
                                      base=(req.origin.lat, req.origin.lon), dest=(req.destination.lat, req.destination.lon), science_hours=cfg.science_hours)
    meta = {}
    for t in dem.all_tiles().values():
        meta[t.id] = {"sha256": t.meta["sha256"], "source_etag": t.meta["source"]["etag"], "built_at_utc": t.meta["built_at_utc"]}
    return {
        "report": "RedReturn mission decision report", "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "reproducibility": {"request": req.model_dump(), "request_sha256": planning.request_hash(req), "seed": req.seed, "risk_result_sha256": rk["result_sha256"],
                            "engine": rk["engine"], "dem_windows": meta, "note": "Re-posting `request` to the same API version reproduces every number except generated_at_utc."},
        "alternatives": alt, "recommended_strategy": alt["recommended"], "analysed_strategy": strategy, "risk": rk, "scenario": scenario,
        "data_sources": registry.provenance(), "limitations": planning.LIMITATIONS, "certification": "NOT_CERTIFIABLE",
    }
