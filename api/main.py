"""RedReturn API: Mars mission decision-support services (educational prototype, not operational)."""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import errors, limits
from .models.schemas import Coordinate  # noqa: F401  (re-export, backward compatible)
from .routers import ares, mission, routes, system, terrain
from .scientific.geodesy import MARS_RADIUS_KM, haversine_km, normalize_lon  # noqa: F401
from .scientific.legacy import astar  # noqa: F401

DESCRIPTION = """Transparent, deterministic Mars mission planning services.

* Terrain data: NASA MGS MOLA 463 m DEM windows (numeric elevation; nodata never filled).
* Monte Carlo outputs use **hypothetical** distributions and are not validated survival probabilities.
* Nothing here certifies a route or mission for human exploration."""

app = FastAPI(title="RedReturn API", version=system.VERSION, description=DESCRIPTION)
origins = [o.strip() for o in os.getenv("REDRETURN_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
limits.install(app)   # added first => inner; CORS is added last => outermost, so 413/429 responses still carry CORS headers
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"], max_age=600)
errors.install(app)
for r in (system.router, terrain.router, routes.router, mission.router, ares.router):
    app.include_router(r)


def distance_km(a: Coordinate, b: Coordinate) -> float:
    """Backward-compatible helper."""
    return haversine_km(a.lat, a.lon, b.lat, b.lon)
