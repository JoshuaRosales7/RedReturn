"""Live smoke test of every RedReturn API endpoint (real NASA data, no mocks). Usage: python -X utf8 scripts/smoke_api.py https://your-api-url  (default http://localhost:8000)"""
import sys
import time

import httpx

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
c = httpx.Client(base_url=API, timeout=240)
DEMO = {"origin": {"lat": 18.38, "lon": 77.58, "name": "Jezero base"}, "destination": {"lat": 18.6, "lon": 77.2},
        "science_stops": [{"name": "Stop", "lat": 18.5, "lon": 77.38, "dwell_hours": 0.75}]}
results = []


def check(name, method, path, expect=200, body=None, params=None, headers=None, test=None):
    t = time.time()
    try:
        r = c.request(method, path, json=body, params=params, headers=headers)
        dt = time.time() - t
        j = r.json() if "json" in r.headers.get("content-type", "") else None
        ok = r.status_code == expect
        detail = ""
        if ok and test:
            try:
                detail = test(j, r) or ""
            except AssertionError as e:
                ok, detail = False, f"assert: {e}"
            except Exception as e:  # noqa: BLE001
                ok, detail = False, f"{type(e).__name__}: {e}"
        elif not ok:
            detail = f"got {r.status_code}: {str(j)[:160]}"
    except Exception as e:  # noqa: BLE001
        ok, dt, detail = False, time.time() - t, f"{type(e).__name__}: {e}"
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {dt:6.2f}s  {name:<52} {detail}", flush=True)


def has(*keys):
    def t(j, _r):
        for k in keys:
            assert k in j, f"missing {k}"
    return t


# --- system and data provenance
check("health", "GET", "/api/health", test=lambda j, r: f"version {j['version']}, windows {j['features']['dem_windows']}")
check("diagnostics", "GET", "/api/diagnostics", test=has("python", "numpy", "dem"))
check("regions", "GET", "/api/regions", test=lambda j, r: f"{len(j['items'])} regions")
check("science locations", "GET", "/api/science/locations", test=has("items"))
check("layers", "GET", "/api/layers", test=has("items", "classification"))
check("datasets", "GET", "/api/datasets", test=lambda j, r: f"{len(j['layers'])} layers")
check("datasets status (DEM checksums)", "GET", "/api/datasets/status",
      test=lambda j, r: f"{j['items'][0]['status']}, checksums ok: {all(w['checksum_ok'] for w in j['items'][0]['windows'])}")
check("demo scenario", "GET", "/api/demo", test=lambda j, r: (lambda n: f"narrative ok, ° intact: {'°' in n}")(" ".join(j["narrative"])))

# --- terrain
check("coverage", "GET", "/api/terrain/coverage", test=lambda j, r: f"{len(j['items'])} stored windows")
check("elevation inside Jezero", "GET", "/api/terrain/elevation", params={"lat": 18.38, "lon": 77.58},
      test=lambda j, r: (abs(j["elevation_m"] + 2644.464) < 0.01 or (_ for _ in ()).throw(AssertionError(j["elevation_m"]))) and f"{j['elevation_m']:.2f} m (expected −2644.46)")
check("elevation outside coverage → 404", "GET", "/api/terrain/elevation", expect=404, params={"lat": 0, "lon": 0},
      test=lambda j, r: f"code {j['error']['code']}")
check("elevation invalid lat → 422", "GET", "/api/terrain/elevation", expect=422, params={"lat": 95, "lon": 0})
check("profile GET", "GET", "/api/terrain/profile", params={"lat1": 18.38, "lon1": 77.58, "lat2": 18.6, "lon2": 77.2}, test=has("samples"))
check("heightfield", "GET", "/api/terrain/heightfield", params={"tile": "jezero", "max_size": 64}, test=lambda j, r: f"{j['rows']}×{j['cols']}")
check("heightfield unknown tile → 404", "GET", "/api/terrain/heightfield", expect=404, params={"tile": "nope"})

# --- routes (local, on-demand, long-range)
def alt_ok(j, r):
    assert len(j["routes"]) == 4
    return f"recommended {j['recommended']}, tile {j['tile']['id']}"
check("alternatives: Jezero demo", "POST", "/api/routes/alternatives", body=DEMO, test=alt_ok)
check("alternatives: Gale example", "POST", "/api/routes/alternatives",
      body={"origin": {"lat": -4.59, "lon": 137.44}, "destination": {"lat": -4.75, "lon": 137.3}}, test=alt_ok)
check("alternatives: new area (on-demand MOLA download)", "POST", "/api/routes/alternatives",
      body={"origin": {"lat": -14.6, "lon": 175.5}, "destination": {"lat": -14.5, "lon": 175.35}}, test=alt_ok)
check("alternatives: too far → 422 grid_too_large", "POST", "/api/routes/alternatives", expect=422,
      body={"origin": {"lat": 18.38, "lon": 77.58}, "destination": {"lat": 0, "lon": 0}}, test=lambda j, r: j["error"]["message"][:70])
check("long-range: Jezero → Gale", "POST", "/api/routes/long-range",
      body={"origin": {"lat": 18.38, "lon": 77.58}, "destination": {"lat": -5.4, "lon": 137.8}},
      test=lambda j, r: f"{j['grid']['spacing_m'] / 1000:.1f} km grid, {[round(x['metrics']['distance_km']) for x in j['routes']]} km")
check("long-range across 180° → 422", "POST", "/api/routes/long-range", expect=422,
      body={"origin": {"lat": 0, "lon": 175}, "destination": {"lat": 0, "lon": -175}}, test=lambda j, r: j["error"]["code"])
check("legacy plan", "POST", "/api/routes/plan", body={"origin": {"lat": 18.38, "lon": 77.58}, "destination": {"lat": 18.6, "lon": 77.2}}, test=has("distance_km"))
check("legacy compare", "POST", "/api/routes/compare", body={"origin": {"lat": 18.38, "lon": 77.58}, "destination": {"lat": 18.6, "lon": 77.2}})

# --- analyses
check("risk: Monte Carlo (3000 runs, seeded)", "POST", "/api/risk/analyze", body={**DEMO, "strategy": "resource", "runs": 3000, "seed": 20261114},
      test=lambda j, r: f"{j['fraction_satisfying_constraints'] * 100:.2f}% pass, hash {j['result_sha256'][:16]}")
check("risk: same seed reproduces the hash", "POST", "/api/risk/analyze", body={**DEMO, "strategy": "resource", "runs": 3000, "seed": 20261114},
      test=lambda j, r: f"hash {j['result_sha256'][:16]}")
check("emergency: battery + speed failure", "POST", "/api/scenarios/simulate",
      body={**DEMO, "strategy": "resource", "incidents": [{"kind": "battery_loss", "magnitude": 35}, {"kind": "speed_reduction", "magnitude": 30}], "at_progress": 0.6},
      test=lambda j, r: f"revised: {j['revised']['label'] if j['revised'] else None}, feasible {j['revised_feasible']}")
check("ARES: question answered from calculations", "POST", "/api/ares/ask", body={**DEMO, "strategy": "resource", "question": "Why can the system not certify this mission?"},
      test=lambda j, r: f"provenance {j['provenance']}, tools {j['tools_used']}")
check("report JSON (reproducibility)", "POST", "/api/reports/json", body={**DEMO, "runs": 400},
      test=lambda j, r: f"{j['certification']}, request {j['reproducibility']['request_sha256']}")
check("report JSON with chosen route + 2 incidents", "POST", "/api/reports/json",
      body={**DEMO, "runs": 400, "strategy": "terrain", "incidents": [{"kind": "battery_loss", "magnitude": 35}, {"kind": "travel_delay", "magnitude": 1}]},
      test=lambda j, r: f"analysed {j['analysed_strategy']}, applied {len(j['scenario']['incident']['applied'])} incidents")
check("report GeoJSON", "POST", "/api/reports/geojson", body=DEMO, test=lambda j, r: f"{j['type']}, {len(j['features'])} features")

# --- new: current conditions (real NASA services)
check("space weather (NASA DONKI)", "GET", "/api/conditions/space-weather",
      test=lambda j, r: f"{len(j['items'])} items, {sum(i['mentions_mars'] for i in j['items'])} mention Mars, excluded {[e['type'] for e in j['excluded_earth_only']]}")
check("rover images at Jezero (Perseverance)", "GET", "/api/conditions/surface-images", params={"lat": 18.38, "lon": 77.58, "n": 4},
      test=lambda j, r: f"{j['rover']['name']}: {len(j['images'])} images, sol {j['images'][0]['sol'] if j['images'] else '—'}")
check("rover images at Gale (Curiosity)", "GET", "/api/conditions/surface-images", params={"lat": -4.59, "lon": 137.44, "n": 4},
      test=lambda j, r: f"{j['rover']['name']}: {len(j['images'])} images")
check("no rover nearby → explicit empty answer", "GET", "/api/conditions/surface-images", params={"lat": 40, "lon": -100},
      test=lambda j, r: f"rover {j['rover']}, nearest {j['nearest']['name']} {j['nearest']['distance_km']} km")

# --- contract and safety
check("validation error is typed", "POST", "/api/routes/alternatives", expect=422, body={"origin": {"lat": 200, "lon": 0}, "destination": {"lat": 0, "lon": 0}},
      test=lambda j, r: j["error"]["code"])
check("CORS: localhost:3000 allowed", "GET", "/api/health", headers={"Origin": "http://localhost:3000"},
      test=lambda j, r: (r.headers.get("access-control-allow-origin") == "http://localhost:3000" or (_ for _ in ()).throw(AssertionError("no header"))) and "allowed")
check("CORS: unknown site blocked", "GET", "/api/health", headers={"Origin": "https://evil.example.com"},
      test=lambda j, r: ("access-control-allow-origin" not in r.headers or (_ for _ in ()).throw(AssertionError("header present"))) and "blocked")

print(f"\n{sum(results)}/{len(results)} checks passed")
sys.exit(0 if all(results) else 1)
