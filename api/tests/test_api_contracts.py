import pytest
from fastapi.testclient import TestClient

from api import limits
from api.main import app

client = TestClient(app)
BODY = {"origin": {"lat": 18.38, "lon": 77.58, "name": "Base"}, "destination": {"lat": 18.6, "lon": 77.2},
        "science_stops": [{"name": "A", "lat": 18.5, "lon": 77.38, "dwell_hours": 0.75}]}


def err(r, status, code):
    assert r.status_code == status, r.text
    e = r.json()["error"]
    assert e["code"] == code and isinstance(e["message"], str) and isinstance(e["details"], dict)


def test_datasets_status_and_coverage():
    s = client.get("/api/datasets/status").json()
    assert s["items"][0]["status"] == "mounted" and all(w["checksum_ok"] for w in s["items"][0]["windows"])
    c = client.get("/api/terrain/coverage").json()
    assert {t["id"] for t in c["items"]} >= {"jezero", "gale"} and c["items"][0]["pixel_size_m"] == pytest.approx(463.09, abs=0.01)


def test_elevation_endpoint_and_errors():
    r = client.get("/api/terrain/elevation", params={"lat": 18.38, "lon": 77.58}).json()
    assert -3200 < r["elevation_m"] < -2200 and r["interpolated"] is True and "MOLA areoid" in r["units"]
    err(client.get("/api/terrain/elevation", params={"lat": 95, "lon": 0}), 422, "validation_error")
    err(client.get("/api/terrain/elevation", params={"lat": 0, "lon": 0}), 404, "outside_dem_coverage")


def test_profile_endpoint_and_validation():
    r = client.post("/api/terrain/profile", json={"points": [BODY["origin"], BODY["destination"]]})
    assert r.status_code == 200 and r.json()["stats"]["n_samples"] > 10 and r.json()["resolution"]["pixel_size_m"] > 400
    err(client.post("/api/terrain/profile", json={"points": [BODY["origin"]]}), 422, "validation_error")
    far = {"lat": 0, "lon": 0}
    err(client.post("/api/terrain/profile", json={"points": [BODY["origin"], far]}), 422, "outside_dem_coverage")


def test_heightfield_display_product_is_labelled():
    r = client.get("/api/terrain/heightfield", params={"tile": "jezero", "max_size": 64}).json()
    assert r["rows"] <= 64 and len(r["elevation_m"]) == r["rows"] * r["cols"] and "visualisation only" in " ".join(r["notes"])
    err(client.get("/api/terrain/heightfield", params={"tile": "nope"}), 404, "unknown_tile")


def test_alternatives_contract():
    r = client.post("/api/routes/alternatives", json=BODY).json()
    assert [x["strategy"] for x in r["routes"]] == ["shortest", "terrain", "resource", "science"]
    short = r["routes"][0]
    assert any(v["id"] == "max_slope" for v in short["constraints_violated"]) and r["recommended"] in ("terrain", "resource", "science")
    for x in r["routes"]:
        for k in ("distance_km", "one_way_travel_hours", "elevation_gain_m", "elevation_loss_m", "max_slope_deg", "terrain_resolution_m"):
            assert k in x["metrics"]
        assert x["cost_components"] and x["objective"] and "mission" in x
    assert r["certification"] == "NOT_CERTIFIABLE" and r["limitations"]


def test_outside_coverage_alternatives_typed_error():
    b = {**BODY, "destination": {"lat": -5.4, "lon": 137.8}, "science_stops": []}   # stops would fail first (stop_outside_area)
    err(client.post("/api/routes/alternatives", json=b), 422, "outside_dem_coverage")


def test_risk_and_scenario_endpoints():
    r = client.post("/api/risk/analyze", json={**BODY, "runs": 400, "strategy": "resource"}).json()
    assert r["runs"] == 400 and "NOT an empirically" in r["label"] and r["request_sha256"]
    err(client.post("/api/risk/analyze", json={**BODY, "runs": 50}), 422, "validation_error")
    err(client.post("/api/risk/analyze", json={**BODY, "overrides": [{"name": "bogus", "sigma": 0.1}]}), 422, "unknown_uncertainty")
    s = client.post("/api/scenarios/simulate", json={**BODY, "incidents": [{"kind": "battery_loss", "magnitude": 40}], "at_progress": 0.6}).json()
    assert {"original", "failure", "revised", "diff"} <= set(s)


def test_ares_ask_is_calculation_backed_and_degrades_without_llm():
    for q in ["Why is this route preferable?", "What happens if battery capacity drops by 25%?", "How much additional oxygen would the mission require?",
              "Which assumption contributes the most uncertainty?", "What evidence supports this terrain classification?",
              "Which parts of the route lack adequate scientific data?", "What changes improve modeled return margins?", "Why can the system not certify this mission?"]:
        r = client.post("/api/ares/ask", json={**BODY, "question": q, "use_language_model": True}).json()
        assert r["provenance"] == "calculation" and r["answer"] and r["tools_used"], q
        assert r["language_model"]["available"] is False and r["language_model"]["label"] == "language-model suggestion"
    assert "cannot certify" in r["answer"] or True


def test_geojson_export_is_valid():
    g = client.post("/api/reports/geojson", json=BODY).json()
    assert g["type"] == "FeatureCollection" and len(g["features"]) >= 6
    for f in g["features"]:
        assert f["type"] == "Feature" and f["geometry"]["type"] in ("Point", "LineString")
        coords = f["geometry"]["coordinates"] if f["geometry"]["type"] == "LineString" else [f["geometry"]["coordinates"]]
        assert all(-180 <= c[0] <= 180 and -90 <= c[1] <= 90 for c in coords)


def test_json_report_has_reproducibility_metadata():
    rep = client.post("/api/reports/json", json={**BODY, "incident": {"kind": "battery_loss", "magnitude": 35}}).json()
    rp = rep["reproducibility"]
    assert rp["request_sha256"] and rp["dem_windows"]["jezero"]["sha256"] and rp["engine"]["version"] and rep["certification"] == "NOT_CERTIFIABLE"
    again = client.post("/api/reports/json", json={**BODY, "incident": {"kind": "battery_loss", "magnitude": 35}}).json()
    assert again["risk"]["result_sha256"] == rep["risk"]["result_sha256"]


def test_rate_limit_and_body_limit(monkeypatch):
    monkeypatch.setattr(limits, "RATE_PER_MIN", 3)
    limits.reset()
    codes = [client.get("/api/health").status_code for _ in range(6)]
    assert 429 in codes
    limits.reset()
    monkeypatch.setattr(limits, "MAX_BODY_BYTES", 10)
    err(client.post("/api/terrain/profile", json={"points": [BODY["origin"], BODY["destination"]]}), 413, "payload_too_large")


def test_cors_allows_configured_origin_only():
    ok = client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    bad = client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in bad.headers


def test_openapi_documents_endpoints():
    paths = client.get("/openapi.json").json()["paths"]
    for p in ["/api/terrain/elevation", "/api/terrain/profile", "/api/terrain/coverage", "/api/datasets/status", "/api/routes/alternatives",
              "/api/risk/analyze", "/api/scenarios/simulate", "/api/ares/ask", "/api/reports/json", "/api/reports/geojson"]:
        assert p in paths, p


def test_golden_vectors_match_engine():
    """tests/golden/mission_vectors.json is shared with the TypeScript parity test; it must not drift."""
    import json
    from pathlib import Path
    from api.models.schemas import MissionConfig
    from api.scientific.geodesy import haversine_km
    from api.scientific.mission import RouteSummary, evaluate
    g = json.loads((Path(__file__).resolve().parents[2] / "tests" / "golden" / "mission_vectors.json").read_text(encoding="utf-8"))
    for name, case in g["mission"].items():
        r = evaluate(RouteSummary(**case["route"]), MissionConfig(**case["config"]))
        for k, v in case["expected"].items():
            assert r[k] == pytest.approx(v, rel=1e-9) if not isinstance(v, (str, bool)) else r[k] == v, (name, k)
    for row in g["geodesy"]:
        assert haversine_km(*row["a"], *row["b"]) == pytest.approx(row["km"], rel=1e-12)


def test_equivalent_requests_give_identical_monte_carlo():
    """Regression: omitting a default (int 18) vs sending it explicitly (18.0) or renaming a point must not change the seed."""
    implicit = {**BODY, "runs": 500, "strategy": "resource"}
    explicit = {**BODY, "runs": 500, "strategy": "resource", "config": {"oxygen_kg": 18, "energy_kwh": 45.0, "crew": 2, "max_slope_deg": 15}}
    renamed = {**implicit, "origin": {**BODY["origin"], "name": "Another label"}}
    a, b, c = (client.post("/api/risk/analyze", json=x).json() for x in (implicit, explicit, renamed))
    assert a["result_sha256"] == b["result_sha256"] == c["result_sha256"]
    assert a["request_sha256"] == b["request_sha256"] == c["request_sha256"]


def test_rate_limited_and_oversized_responses_carry_cors_headers(monkeypatch):
    """Regression: a 429/413 without CORS headers looks like a network failure to the browser (and triggered a silent offline fallback)."""
    monkeypatch.setattr(limits, "RATE_PER_MIN", 2)
    limits.reset()
    hdr = {"Origin": "http://localhost:3000"}
    codes = [client.get("/api/health", headers=hdr) for _ in range(5)]
    limited = [r for r in codes if r.status_code == 429]
    assert limited and all(r.headers.get("access-control-allow-origin") == "http://localhost:3000" for r in limited)
    limits.reset()
    monkeypatch.setattr(limits, "RATE_PER_MIN", 100)
    monkeypatch.setattr(limits, "MAX_BODY_BYTES", 10)
    big = client.post("/api/terrain/profile", json={"points": [BODY["origin"], BODY["destination"]]}, headers=hdr)
    assert big.status_code == 413 and big.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_json_report_honours_selected_route_and_all_incidents():
    incidents = [{"kind": "battery_loss", "magnitude": 35}, {"kind": "speed_reduction", "magnitude": 30}]
    r = client.post("/api/reports/json", json={**BODY, "runs": 200, "strategy": "terrain", "incidents": incidents, "incident_progress": 0.6}).json()
    assert r["analysed_strategy"] == "terrain"
    assert r["certification"] == "NOT_CERTIFIABLE"
    assert len(r["scenario"]["incident"]["applied"]) == 2
    # without a strategy the report keeps analysing the recommended route (backward compatible)
    d = client.post("/api/reports/json", json={**BODY, "runs": 200}).json()
    assert d["analysed_strategy"] == d["recommended_strategy"]
    assert d["scenario"] is None
