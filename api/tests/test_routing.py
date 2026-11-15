import numpy as np
import pytest

from api.scientific import dem, routing
from api.scientific.legacy import astar
from .conftest import make_tile

MOB = routing.Mobility(max_slope_deg=15)


def wall_tile(gap: bool = True):
    z = np.zeros((80, 80))
    z[:, 40] = 3000      # 3 km "ridge" across the whole tile ...
    if gap:
        z[60:63, 40] = 0  # ... with a narrow gap
    return make_tile(z, lat_top=0.3)


def pts(t, r0, c0, r1, c1):
    return t.cell_center(r0, c0), t.cell_center(r1, c1)


def test_terrain_route_uses_gap_and_respects_slope_cap():
    t = wall_tile()
    a, b = pts(t, 20, 10, 20, 70)
    r = routing.optimised_route(t, "terrain", a, b, MOB)
    assert r["metrics"]["max_slope_deg"] <= 15 and not r["constraints_violated"]
    rows = [t.nearest_cell(c["lat"], c["lon"])[0] for c in r["coordinates"]]
    assert max(rows) >= 59                       # went down through the gap


def test_shortest_route_reports_slope_violation():
    t = wall_tile()
    a, b = pts(t, 20, 10, 20, 70)
    s = routing.shortest_route(t, a, b, MOB)
    assert any(v["id"] == "max_slope" for v in s["constraints_violated"])


def test_blocked_route_raises_typed_error():
    t = wall_tile(gap=False)
    a, b = pts(t, 20, 10, 20, 70)
    with pytest.raises(routing.RouteError) as e:
        routing.optimised_route(t, "terrain", a, b, MOB)
    assert e.value.code == "no_traversable_route"


def test_nodata_cells_are_impassable_not_filled():
    z = np.zeros((60, 60)); z[:, 30] = np.nan
    t = make_tile(z, lat_top=0.2)
    a, b = pts(t, 10, 5, 10, 55)
    with pytest.raises(routing.RouteError):
        routing.optimised_route(t, "terrain", a, b, MOB)
    z[24:37, 30] = 0                               # open a corridor: cells touching nodata have unknown slope and stay blocked
    r = routing.optimised_route(make_tile(z, lat_top=0.2), "terrain", a, b, MOB)
    assert r["metrics"]["nodata_samples"] == 0


def test_endpoint_on_nodata_is_error():
    z = np.zeros((20, 20)); z[5, 5] = np.nan
    t = make_tile(z)
    with pytest.raises(routing.RouteError) as e:
        routing.optimised_route(t, "terrain", t.cell_center(5, 5), t.cell_center(15, 15), MOB)
    assert e.value.code == "endpoint_nodata"


def test_objectives_are_materially_different_on_real_dem():
    t = dem.all_tiles()["jezero"]
    a, b = (18.38, 77.58), (18.6, 77.2)
    paths = {s: routing.optimised_route(t, s, a, b, MOB) for s in ("terrain", "resource")}
    short = routing.shortest_route(t, a, b, MOB)
    assert short["metrics"]["max_slope_deg"] > 15 and short["constraints_violated"]
    assert paths["terrain"]["coordinates"] != paths["resource"]["coordinates"]
    assert paths["terrain"]["metrics"]["distance_km"] > short["metrics"]["distance_km"]   # detour around steep ground
    assert all(not p["constraints_violated"] for p in paths.values())


def test_science_without_stops_is_downgraded_with_explanation():
    t = wall_tile()
    a, b = pts(t, 20, 10, 20, 70)
    r = routing.optimised_route(t, "science", a, b, MOB, stops=[])
    assert r["status"] == "downgraded" and "no science-value dataset" in r["note"]


def test_science_visits_stops():
    t = make_tile(np.zeros((100, 100)), lat_top=0.4)
    a, b = t.cell_center(50, 5), t.cell_center(50, 95)
    stop = {"lat": t.cell_center(20, 50)[0], "lon": t.cell_center(20, 50)[1], "dwell_hours": 1.0, "weight": 2.0}
    r = routing.optimised_route(t, "science", a, b, MOB, stops=[stop])
    rows = [t.nearest_cell(c["lat"], c["lon"])[0] for c in r["coordinates"]]
    assert min(rows) <= 21 and r["science_stops_visited"][0]["weight"] == 2.0


def test_obstruction_mask_forces_detour_or_blocks():
    t = make_tile(np.zeros((100, 100)), lat_top=0.4)
    a, b = t.cell_center(50, 5), t.cell_center(50, 95)
    direct = routing.optimised_route(t, "terrain", a, b, MOB)
    mask = routing.obstruction_mask(t, t.cell_center(50, 50), 6.0)
    detour = routing.optimised_route(t, "terrain", a, b, MOB, blocked=mask)
    assert detour["metrics"]["distance_km"] > direct["metrics"]["distance_km"]


def test_flat_resource_and_terrain_costs_positive():
    assert routing._edge_cost("resource", routing.Mobility(), 463, 0, 0, 0) > 0
    assert routing._edge_cost("terrain", routing.Mobility(), 463, 0, 0, 0) == 463


def test_legacy_astar_blocks_nonfinite():
    path = astar([[1, 1, 1], [1, float("inf"), 1], [1, 1, 1]], (0, 0), (2, 2))
    assert (1, 1) not in path and path[0] == (0, 0) and path[-1] == (2, 2)
    with pytest.raises(ValueError):
        astar([[1, float("nan"), 1]], (0, 0), (0, 2))
