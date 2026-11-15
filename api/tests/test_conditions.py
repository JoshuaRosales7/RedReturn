"""Conditions endpoints with the NASA services mocked (no network)."""
from fastapi.testclient import TestClient

from api.main import app
from api.services import conditions

client = TestClient(app)

DONKI = [
    {"messageType": "RBE", "messageIssueTime": "2026-11-10T10:00Z", "messageURL": "u1", "messageBody": "## Summary:\nElectrons near Earth.\n##"},
    {"messageType": "CME", "messageIssueTime": "2026-11-12T08:00Z", "messageURL": "u2",
     "messageBody": "## Summary:\nCME detected. Estimated impact: Mars, STEREO A.\n## Notes"},
    {"messageType": "FLR", "messageIssueTime": "2026-11-14T01:00Z", "messageURL": "u3",
     "messageBody": "## Summary:\nM2.1 flare, analysed by the Moon to Mars Space Weather Analysis Office.\n##"},   # office name ≠ Mars impact
    {"messageType": "GST", "messageIssueTime": "2026-11-13T01:00Z", "messageURL": "u4", "messageBody": "Kp 7"},
]
M2020 = {"images": [
    {"camera": {"instrument": "SUPERCAM_RMI"}, "image_files": {"medium": "rmi.jpg"}, "sol": 2031},
    {"camera": {"instrument": "MCZ_LEFT"}, "image_files": {"medium": "m.jpg", "full_res": "f.png"}, "sol": 2031, "date_taken_utc": "2026-11-06T12:00",
     "title": "Sol 2031: Mastcam-Z", "credit": "NASA/JPL-Caltech/ASU", "link": "https://mars.nasa.gov/x"},
]}


MSL = {"items": [{"https_url": "https://mars.nasa.gov/msl-raw-images/msss/05073/mcam/x.jpg", "sol": 5073, "instrument": "MAST_RIGHT",
                   "date_taken": "2026-11-13T17:24:28.000Z", "title": "Sol 5073: Mastcam", "link": "/raw_images/1"}]}


def _mock(monkeypatch, calls):
    def fake(url, params):
        calls.append(url)
        return DONKI if "DONKI" in url else MSL if "raw_image_items" in url else M2020
    monkeypatch.setattr(conditions, "_fetch_json", fake)
    monkeypatch.setattr(conditions, "_cache", {})


def test_space_weather_keeps_mars_relevant_items_and_flags_mars(monkeypatch):
    calls = []
    _mock(monkeypatch, calls)
    j = client.get("/api/conditions/space-weather").json()
    assert [i["type"] for i in j["items"]] == ["FLR", "CME"]                 # newest first, Earth-only types removed
    assert j["items"][1]["mentions_mars"] is True and j["items"][0]["mentions_mars"] is False
    assert {e["type"] for e in j["excluded_earth_only"]} == {"RBE", "GST"}
    assert "never change a calculated number" in j["note"]
    client.get("/api/conditions/space-weather")
    assert len(calls) == 1                                                     # cached


def test_surface_images_only_inside_a_rover_region(monkeypatch):
    calls = []
    _mock(monkeypatch, calls)
    j = client.get("/api/conditions/surface-images", params={"lat": 18.38, "lon": 77.58}).json()
    assert j["rover"]["name"] == "Perseverance" and [i["camera"] for i in j["images"]] == ["Mcz Left"]
    assert "not at your waypoints" in j["note"]
    far = client.get("/api/conditions/surface-images", params={"lat": 40, "lon": -100}).json()
    assert far["rover"] is None and far["images"] == [] and far["nearest"]["distance_km"] > 1000
    ref = client.get("/api/conditions/surface-images", params={"lat": 40, "lon": -100, "nearest": True}).json()
    assert ref["reference_only"] is True and ref["images"] and "not your terrain" in ref["note"]
    assert client.get("/api/conditions/surface-images", params={"lat": 18.38, "lon": 77.58}).json()["reference_only"] is False


def test_upstream_failure_is_a_typed_error(monkeypatch):
    def boom(url, params):
        raise conditions.ApiError(502, "upstream_unavailable", "The NASA service did not answer.")
    monkeypatch.setattr(conditions, "_fetch_json", boom)
    monkeypatch.setattr(conditions, "_cache", {})
    r = client.get("/api/conditions/space-weather")
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_unavailable"
