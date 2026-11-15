from __future__ import annotations

from fastapi import APIRouter

from ..models.schemas import AlternativesRequest, CompareRequest, RouteRequest, RouteResult
from ..scientific.geodesy import haversine_km
from ..services import planning

router = APIRouter(prefix="/api/routes", tags=["routes"])


def _legacy(req: RouteRequest) -> RouteResult:
    pts = [req.origin, *req.waypoints, req.destination]
    d = sum(haversine_km(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon) for i in range(len(pts) - 1))
    warnings = ["Global geometric route only; terrain hazards and local obstacles are not evaluated. Use /api/routes/alternatives for DEM-based planning."]
    return RouteResult(coordinates=pts, distance_km=d, strategy=req.strategy, quality="global-geometric", terrain_evaluated=False, warnings=warnings)


@router.post("/plan", response_model=RouteResult)
def plan(req: RouteRequest):
    return _legacy(req)


@router.post("/compare", response_model=list[RouteResult])
def compare(req: CompareRequest):
    return [_legacy(RouteRequest(origin=req.origin, destination=req.destination, strategy=s)) for s in req.strategies]


@router.post("/alternatives")
def alternatives(req: AlternativesRequest):
    return planning.alternatives(req.origin, req.destination, req.config, req.science_stops, req.strategies)


@router.post("/long-range")
def long_range(req: AlternativesRequest):
    """Strategic overview route for points too far apart for local planning (subsampled real MOLA grid)."""
    return planning.long_range(req.origin, req.destination, req.config)
