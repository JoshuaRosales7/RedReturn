from __future__ import annotations

import os
import platform
import sys

import numpy as np
from fastapi import APIRouter

from ..datasets import registry
from ..scientific import dem
from ..services import ares

router = APIRouter()
VERSION = "0.3.0"

LOCATIONS = [
    {"id": "jezero", "name": "Jezero Crater", "lat": 18.38, "lon": 77.58, "type": "crater"},
    {"id": "gale", "name": "Gale Crater", "lat": -5.4, "lon": 137.8, "type": "crater"},
    {"id": "olympus", "name": "Olympus Mons", "lat": 18.65, "lon": -133.8, "type": "volcano"},
    {"id": "valles", "name": "Valles Marineris", "lat": -13.9, "lon": -59.2, "type": "canyon"},
]


@router.get("/api/health", tags=["system"])
def health():
    return {"status": "ok", "service": "redreturn", "version": VERSION,
            "features": {"dem_windows": sorted(dem.all_tiles()), "ares_calculation": True,
                         "generative_ai": bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_MODEL"))},
            "ai_runtime": ares.AI_RUNTIME_STATUS}


@router.get("/api/diagnostics", tags=["system"])
def diagnostics():
    return {"version": VERSION, "python": sys.version.split()[0], "platform": platform.platform(), "numpy": np.__version__,
            "dem": registry.status(), "limits": {"rate_per_min": os.getenv("REDRETURN_RATE_PER_MIN", "600"),
                                                 "max_body_bytes": os.getenv("REDRETURN_MAX_BODY_BYTES", "200000")}}


@router.get("/api/regions", tags=["system"])
def regions():
    return {"coordinate_convention": "planetocentric latitude, east-positive longitude", "items": LOCATIONS}


@router.get("/api/science/locations", tags=["system"])
def science_locations():
    return {"items": LOCATIONS, "provenance": "Curated named features; verify mission-critical coordinates against the USGS Planetary Gazetteer."}


@router.get("/api/layers", tags=["datasets"])
def layers():
    return {"items": registry.provenance()["layers"], "classification": registry.CLASSES}


@router.get("/api/datasets", tags=["datasets"])
def datasets():
    return registry.provenance()


@router.get("/api/datasets/status", tags=["datasets"])
def datasets_status():
    return registry.status()


@router.get("/api/demo", tags=["system"])
def demo():
    """Canonical reproducible demonstration scenario (inputs only; call the other endpoints to compute)."""
    import json
    from pathlib import Path
    return json.loads((Path(__file__).resolve().parent.parent / "data" / "demo_scenario.json").read_text(encoding="utf-8"))
