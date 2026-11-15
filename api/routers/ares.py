from __future__ import annotations

from fastapi import APIRouter

from ..models.schemas import AresRequest, AskRequest
from ..scientific import risk
from ..scientific.mission import flat_summary
from ..services import ares

router = APIRouter(tags=["ares"])


@router.post("/api/ares/ask")
def ask(req: AskRequest):
    return ares.answer(req)


@router.post("/api/ai/mission-copilot", deprecated=True)
def mission_copilot(req: AresRequest):
    """Legacy global-geometry scenario analysis. Prefer /api/risk/analyze + /api/ares/ask."""
    summary = flat_summary(req.route.distance_km)
    out = risk.analyze(summary, req.config, runs=req.runs, seed=1, request_payload=req.model_dump(exclude={"question"}), with_sensitivity=True)
    top = out["sensitivity"][0]["label"] if out["sensitivity"] else "n/a"
    out.update({
        "mode": "local", "survivalProbability": round(out["fraction_satisfying_constraints"] * 100, 2),
        "deprecated_fields": {"survivalProbability": "Renamed: scenario pass fraction under assumed distributions, not a survival probability."},
        "criticalFactor": out["dominant_failure_mode"] or "none",
        "headline": "Scenario ensemble (hypothetical inputs)",
        "briefing": f"{out['runs']:,} simulated scenarios; {out['fraction_satisfying_constraints'] * 100:.0f}% satisfy modelled constraints. Most influential assumption: {top}.",
        "answer": out["label"], "actions": [], "caveats": ["Distributions are assumptions, not forecasts.", "Global geometry only; no terrain evaluated."],
    })
    return out
