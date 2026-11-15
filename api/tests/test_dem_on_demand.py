"""On-demand MOLA windows, tested against a synthetic byte source with the real global-mosaic geometry (no network)."""
import json

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient

from api.datasets import mola_remote
from api.main import app
from api.scientific import dem

W, H, ROW, BASE = 46080, 23040, 46080 * 2, 1000
LAYOUT = {"width": W, "height": H, "offsets": [BASE + r * ROW for r in range(H)], "px": 463.0935415503709, "py": 463.0935415503709,
          "x0": -10669675.197320545, "y0": 5334837.598660273, "etag": '"synthetic"', "last_modified": "n/a", "content_length": str(BASE + H * ROW)}
client = TestClient(app)


def synthetic(r: np.ndarray, c: np.ndarray) -> np.ndarray:
    return (np.sin(r / 9.0) * 300 + np.cos(c / 11.0) * 200 - 2000).astype("<i2")


@pytest.fixture()
def remote(monkeypatch, tmp_path):
    calls = {"n": 0}

    def fake_get(_client, start, length):
        calls["n"] += 1
        r, c0 = divmod(start - BASE, ROW)
        return synthetic(np.full(length // 2, r), np.arange(c0 // 2, c0 // 2 + length // 2)).tobytes()

    monkeypatch.setenv("REDRETURN_DEM_ON_DEMAND", "1")
    monkeypatch.setattr(mola_remote, "ONDEMAND_DIR", tmp_path)
    monkeypatch.setattr(mola_remote, "_layout_for", lambda _c: LAYOUT)
    monkeypatch.setattr(mola_remote, "_get", fake_get)
    monkeypatch.setattr(mola_remote, "_recent", mola_remote.deque())
    before = set(dem.all_tiles())
    yield calls
    for k in set(dem.all_tiles()) - before:          # keep the shared registry clean for other tests
        dem.all_tiles().pop(k)


ROUTE = {"origin": {"lat": 11.716, "lon": 67.693}, "destination": {"lat": 11.80, "lon": 67.55}}


def test_window_sizing_and_limits():
    lat0, lat1, lon0, lon1 = mola_remote.plan_window([(11.7, 67.7), (11.8, 67.5)])
    assert lat0 < 11.7 and lat1 > 11.8 and lon0 < 67.5 and lon1 > 67.7 and lat1 - lat0 >= 2 * mola_remote.MIN_HALF_DEG
    with pytest.raises(mola_remote.RemoteDemError) as e:
        mola_remote.plan_window([(0, 0), (0, 5)])
    assert e.value.code == "grid_too_large"
    assert mola_remote.plan_window([(89.9, 0), (89.8, 1)])[1] <= 90          # clamped at the pole, never outside the mosaic


def test_route_outside_shipped_windows_downloads_exact_source_values(remote, tmp_path):
    r = client.post("/api/routes/alternatives", json=ROUTE)
    assert r.status_code == 200, r.text
    tile_id = r.json()["tile"]["id"]
    assert tile_id.startswith("area_") and len(r.json()["routes"]) == 4
    meta = json.loads(next(tmp_path.glob("mola_*.json")).read_text(encoding="utf-8"))
    assert meta["on_demand"] is True and meta["source"]["range_read_url"].endswith("global_463m.tif")
    t = dem.all_tiles()[tile_id]
    r0, c0 = meta["window"]["row_off"], meta["window"]["col_off"]
    assert t.z[5, 7] == synthetic(np.array(r0 + 5), np.array(c0 + 7))   # stored values are the source int16, untouched
    n = remote["n"]
    assert client.post("/api/routes/alternatives", json=ROUTE).status_code == 200
    assert remote["n"] == n                                                # second request reuses the cached window
    assert any(i["id"] == tile_id for i in client.get("/api/terrain/coverage").json()["items"])


def test_download_failure_is_an_explicit_error(remote, monkeypatch):
    def boom(*_a, **_k):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(mola_remote, "_get", boom)
    r = client.post("/api/routes/alternatives", json={"origin": {"lat": -30.0, "lon": -40.0}, "destination": {"lat": -30.1, "lon": -40.1}})
    assert r.status_code == 502 and r.json()["error"]["code"] == "dem_download_failed"


def test_disabled_keeps_typed_outside_coverage_error(monkeypatch):
    monkeypatch.setenv("REDRETURN_DEM_ON_DEMAND", "0")
    r = client.post("/api/routes/alternatives", json=ROUTE)
    assert r.status_code == 422 and r.json()["error"]["code"] == "outside_dem_coverage"


def test_download_rate_limit_is_explicit(remote, monkeypatch):
    monkeypatch.setattr(mola_remote, "MAX_PER_MIN", 1)
    monkeypatch.setattr(mola_remote, "_recent", mola_remote.deque())
    assert client.post("/api/routes/alternatives", json={"origin": {"lat": 40.0, "lon": 10.0}, "destination": {"lat": 40.1, "lon": 10.1}}).status_code == 200
    r = client.post("/api/routes/alternatives", json={"origin": {"lat": -40.0, "lon": -10.0}, "destination": {"lat": -40.1, "lon": -10.1}})
    assert r.status_code == 429 and r.json()["error"]["code"] == "download_rate_limited"
    assert r.json()["error"]["details"]["retry_after_s"] > 0


def test_oldest_downloads_are_evicted_beyond_the_cap(remote, monkeypatch, tmp_path):
    monkeypatch.setattr(mola_remote, "MAX_CACHED", 1)
    monkeypatch.setattr(mola_remote, "_recent", mola_remote.deque())
    a = client.post("/api/routes/alternatives", json={"origin": {"lat": 30.0, "lon": 20.0}, "destination": {"lat": 30.1, "lon": 20.1}}).json()["tile"]["id"]
    b = client.post("/api/routes/alternatives", json={"origin": {"lat": -30.0, "lon": -20.0}, "destination": {"lat": -30.1, "lon": -20.1}}).json()["tile"]["id"]
    assert a != b
    assert [p.stem for p in tmp_path.glob("mola_*.json")] == [f"mola_{b}"]       # files of the oldest area are gone
    assert a not in dem.all_tiles() and b in dem.all_tiles()                       # and it is no longer served


LONG = {"origin": {"lat": 18.38, "lon": 77.58}, "destination": {"lat": -4.59, "lon": 137.44}}


def test_long_range_uses_exact_subsampled_source_values(remote, monkeypatch):
    monkeypatch.setattr(mola_remote, "_coarse_cache", {})
    r = client.post("/api/routes/long-range", json=LONG)
    assert r.status_code == 200, r.text
    j = r.json()
    g = j["grid"]
    assert j["mode"] == "long_range" and g["factor"] >= 2 and g["rows"] * g["cols"] <= mola_remote.COARSE_MAX_CELLS * 1.1
    assert {x["strategy"] for x in j["routes"]} == {"shortest", "terrain"}
    assert all(x["metrics"]["distance_km"] > 3000 for x in j["routes"])
    assert j["certification"] == "NOT_CERTIFIABLE" and any("Strategic overview" in t for t in j["limitations"])
    c = mola_remote._coarse_cache[next(iter(mola_remote._coarse_cache))]
    r0, c0, f = c["bounds_px"]["row_off"], c["bounds_px"]["col_off"], c["factor"]
    assert c["z"][3, 4] == synthetic(np.array(r0 + 3 * f), np.array(c0 + 4 * f))    # sampled, never averaged
    n = remote["n"]
    assert client.post("/api/routes/long-range", json=LONG).status_code == 200
    assert remote["n"] == n                                                          # cached grid reused


def test_long_range_between_opposite_sides_goes_the_long_way_round(remote, monkeypatch):
    monkeypatch.setattr(mola_remote, "_coarse_cache", {})
    r = client.post("/api/routes/long-range", json={"origin": {"lat": 18.65, "lon": -133.8}, "destination": {"lat": 18.38, "lon": 77.58}})
    assert r.status_code == 200, r.text
    j = r.json()
    assert [x["strategy"] for x in j["routes"]] == ["terrain"]                 # no great-circle line off the grid
    assert any("180° meridian" in t for t in j["limitations"])


def test_far_science_stop_is_a_clear_error(monkeypatch):
    monkeypatch.setenv("REDRETURN_DEM_ON_DEMAND", "0")
    body = {"origin": {"lat": 18.65, "lon": -133.8}, "destination": {"lat": 18.9, "lon": -133.5},
            "science_stops": [{"name": "Old Jezero stop", "lat": 18.5, "lon": 77.38, "dwell_hours": 0.75}]}
    r = client.post("/api/routes/alternatives", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "stop_outside_area"
    assert "Old Jezero stop" in r.json()["error"]["message"]
