from __future__ import annotations

from fastapi import APIRouter, Query

from ..services import conditions

router = APIRouter(prefix="/api/conditions", tags=["conditions"])


@router.get("/space-weather")
def space_weather(days: int = Query(30, ge=1, le=60)):
    """Recent NASA CCMC DONKI space-weather notifications relevant beyond Earth (cached)."""
    return conditions.space_weather(days)


@router.get("/surface-images")
def surface_images(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=360), n: int = Query(8, ge=1, le=24)):
    """Latest raw rover images when the location is inside a NASA rover's operating region (cached)."""
    return conditions.surface_images(lat, lon, n)
