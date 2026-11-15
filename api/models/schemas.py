"""Pydantic contracts shared by all routers."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Strategy = Literal["direct", "conservative", "science", "limited"]          # legacy names
RouteStrategy = Literal["shortest", "terrain", "resource", "science"]
MAX_POINTS = 20


class Coordinate(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=360)
    name: str | None = Field(None, max_length=120)


class MissionConfig(BaseModel):
    crew: int = Field(2, ge=1, le=12)
    speed_kmh: float = Field(4.5, gt=0, le=50)
    oxygen_kg: float = Field(18, ge=0, le=10_000)
    oxygen_kg_per_person_hour: float = Field(0.084, gt=0, le=10)
    energy_kwh: float = Field(45, ge=0, le=100_000)
    energy_kwh_per_hour: float = Field(1.2, gt=0, le=1000)
    water_liters: float = Field(12, ge=0, le=100_000)
    water_liters_per_person_day: float = Field(2.5, gt=0, le=100)
    radiation_msv_per_hour: float = Field(0.025, ge=0, le=100)
    max_radiation_msv: float = Field(1, gt=0, le=10_000)
    reserve_percent: float = Field(20, ge=0, lt=100)
    max_hours: float = Field(18, gt=0, le=10_000)
    science_hours: float = Field(1.5, ge=0, le=1000)
    contingency_percent: float = Field(15, ge=0, le=200)
    return_required: bool = True
    # mobility assumptions (scenario parameters, not measured vehicle data)
    max_slope_deg: float = Field(15, gt=0, le=45)
    rover_mass_kg: float = Field(1500, gt=0, le=100_000)
    drivetrain_efficiency: float = Field(0.6, gt=0, le=1)


class RouteResult(BaseModel):
    """Legacy route contract (global geometry)."""
    coordinates: list[Coordinate] = Field(max_length=2000)
    distance_km: float = Field(ge=0, le=100_000)
    strategy: str
    quality: Literal["global-geometric", "mola-evaluated", "high-resolution-dem"] = "global-geometric"
    terrain_evaluated: bool = False
    warnings: list[str] = Field(default_factory=list)


class RouteRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    waypoints: list[Coordinate] = Field(default_factory=list, max_length=MAX_POINTS)
    strategy: Strategy = "direct"


class CompareRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    strategies: list[Strategy] = Field(["direct", "conservative", "science", "limited"], max_length=4)


class MissionRequest(BaseModel):
    route: RouteResult
    config: MissionConfig = MissionConfig()


class SimulationRequest(MissionRequest):
    steps: int = Field(30, ge=2, le=1000)


class ScienceStop(BaseModel):
    name: str | None = Field(None, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=360)
    dwell_hours: float = Field(1.0, ge=0, le=100)
    weight: float = Field(1.0, ge=0, le=100)


class AlternativesRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    config: MissionConfig = MissionConfig()
    science_stops: list[ScienceStop] = Field(default_factory=list, max_length=5)
    strategies: list[RouteStrategy] = Field(["shortest", "terrain", "resource", "science"], max_length=4)


class ProfileRequest(BaseModel):
    points: list[Coordinate] = Field(min_length=2, max_length=MAX_POINTS)


class Uncertainty(BaseModel):
    """Override of a default sampling distribution."""
    name: str
    sigma: float | None = Field(None, ge=0, le=2)     # relative std dev around nominal 1.0


class RiskRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    strategy: RouteStrategy = "terrain"
    config: MissionConfig = MissionConfig()
    science_stops: list[ScienceStop] = Field(default_factory=list, max_length=5)
    runs: int = Field(2000, ge=200, le=20_000)
    seed: int = Field(20261114, ge=0, lt=2**32)
    overrides: list[Uncertainty] = Field(default_factory=list, max_length=12)


IncidentKind = Literal["battery_loss", "speed_reduction", "oxygen_increase", "water_loss", "extended_science",
                       "travel_delay", "comms_reduction", "route_obstruction"]


class Incident(BaseModel):
    kind: IncidentKind
    magnitude: float = Field(ge=0, le=1000, description="percent, or hours for extended_science/travel_delay, or km radius for route_obstruction")


class ScenarioRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    strategy: RouteStrategy = "terrain"
    config: MissionConfig = MissionConfig()
    science_stops: list[ScienceStop] = Field(default_factory=list, max_length=5)
    incidents: list[Incident] = Field(min_length=1, max_length=4)
    at_progress: float = Field(0.5, ge=0, le=1, description="fraction of the outbound leg completed when the incident occurs")


class AresRequest(MissionRequest):
    question: str = Field("", max_length=500)
    runs: int = Field(1200, ge=100, le=5000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    origin: Coordinate
    destination: Coordinate
    strategy: RouteStrategy = "terrain"
    config: MissionConfig = MissionConfig()
    science_stops: list[ScienceStop] = Field(default_factory=list, max_length=5)
    use_language_model: bool = False


class ReportRequest(BaseModel):
    origin: Coordinate
    destination: Coordinate
    config: MissionConfig = MissionConfig()
    science_stops: list[ScienceStop] = Field(default_factory=list, max_length=5)
    runs: int = Field(2000, ge=200, le=20_000)
    seed: int = Field(20261114, ge=0, lt=2**32)
    incident_progress: float = Field(0.5, ge=0, le=1)
    incident: Incident | None = None
    incidents: list[Incident] | None = Field(None, max_length=4)   # supersedes `incident` when given
    strategy: RouteStrategy | None = None                          # working plan; default = recommended route
