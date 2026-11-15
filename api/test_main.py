"""Legacy contract tests (kept for backward compatibility) – full suites live in api/tests/."""
from fastapi.testclient import TestClient

from api.main import Coordinate, app, astar, distance_km

client = TestClient(app)
ROUTE = {"coordinates": [{"lat": 0, "lon": 0}, {"lat": 0, "lon": 1}], "distance_km": 59.27, "strategy": "direct",
         "quality": "global-geometric", "terrain_evaluated": False, "warnings": []}


def test_health():
    assert client.get("/api/health").status_code == 200


def test_antimeridian_short_arc():
    assert distance_km(Coordinate(lat=0, lon=179), Coordinate(lat=0, lon=-179)) < 120


def test_astar_avoids_blocked_cell():
    path = astar([[1, 1, 1], [1, float("inf"), 1], [1, 1, 1]], (0, 0), (2, 2))
    assert (1, 1) not in path and path[0] == (0, 0) and path[-1] == (2, 2)


def test_elevation_outside_coverage_is_typed_error_never_zero():
    response = client.get("/api/terrain/elevation?lat=0&lon=0")
    assert response.status_code == 404 and response.json()["error"]["code"] == "outside_dem_coverage"


def test_impossible_mission():
    response = client.post("/api/mission/evaluate", json={"route": ROUTE, "config": {"oxygen_kg": 0, "energy_kwh": 0}})
    assert response.status_code == 200 and response.json()["feasible_within_model"] is False


def test_legacy_copilot_is_reproducible_and_relabelled():
    payload = {"route": ROUTE, "config": {"oxygen_kg": 1, "energy_kwh": 5}, "runs": 200, "question": "q"}
    a, b = client.post("/api/ai/mission-copilot", json=payload), client.post("/api/ai/mission-copilot", json=payload)
    assert a.status_code == 200 and a.json()["result_sha256"] == b.json()["result_sha256"]
    assert a.json()["runs"] == 200 and a.json()["mode"] == "local" and "deprecated_fields" in a.json()
