import math

import numpy as np
import pytest
import rasterio

from api.scientific import dem
from api.scientific.geodesy import MARS_RADIUS_M
from .conftest import make_tile


def test_cell_center_sample_returns_exact_cell_value():
    z = np.arange(100, dtype=float).reshape(10, 10)
    t = make_tile(z)
    lat, lon = t.cell_center(3, 4)
    s = t.sample(lat, lon)
    assert s.status == "cell_value" and s.elevation_m == z[3, 4]


def test_midpoint_is_interpolated_and_flagged():
    z = np.zeros((10, 10)); z[:, 5:] = 10
    t = make_tile(z)
    lat, lon = t.cell_center(4, 4)
    s = t.sample(lat, lon + t.dlon / 2)
    assert s.status == "interpolated" and s.elevation_m == pytest.approx(5.0)


def test_nodata_propagates_never_filled():
    z = np.ones((10, 10)); z[4, 4] = np.nan
    t = make_tile(z)
    lat, lon = t.cell_center(4, 4)
    assert t.sample(lat, lon).elevation_m is None
    s = t.sample(lat + t.dlat / 2, lon + t.dlon / 2)   # stencil touches the nodata cell
    assert s.status == "nodata" and s.elevation_m is None


def test_outside_coverage_is_reported():
    t = make_tile(np.zeros((10, 10)))
    s = t.sample(45, 100)
    assert s.status == "outside_coverage" and s.elevation_m is None


def test_slope_of_known_plane():
    n = 40
    t = make_tile(np.zeros((n, n)), lat_top=0.1)
    dx = math.radians(t.dlon) * MARS_RADIUS_M
    t.z[:] = np.arange(n)[None, :] * dx * 0.1        # rise 0.1 per metre eastward
    slope = t.slope_deg
    expected = math.degrees(math.atan(0.1))
    assert np.nanmean(slope[5:-5, 5:-5]) == pytest.approx(expected, abs=0.02)
    assert np.isnan(slope[0, :]).all() and np.isnan(slope[:, 0]).all()


def test_slope_nodata_neighbourhood_is_nan():
    z = np.zeros((10, 10)); z[5, 5] = np.nan
    t = make_tile(z)
    s = t.slope_deg
    assert np.isnan(s[4:7, 4:7]).all() and not np.isnan(s[2, 2])


def test_profile_flat_and_gap_accounting():
    z = np.zeros((60, 60)); z[:, 30] = np.nan
    t = make_tile(z, lat_top=0.5)
    lat = 0.25
    p = dem.sample_profile(t, [(lat, 10.05), (lat, 10.4)])
    assert p["stats"]["gain_m"] == 0 and p["stats"]["nodata_samples"] >= 1 and p["stats"]["gap_segments"] >= 1


def test_profile_too_many_samples_rejected():
    t = make_tile(np.zeros((1000, 1000)), lat_top=4)
    with pytest.raises(dem.DemError):
        dem.sample_profile(t, [(0.1, 10.0), (3.9, 17.0)], max_samples=50)


# ---- real NASA MOLA window -------------------------------------------------------------
def test_real_cell_matches_independent_rasterio_read():
    t = dem.all_tiles()["jezero"]
    tif = dem.DEM_DIR / t.meta["file"]
    with rasterio.open(tif) as ds:
        for row, col in [(10, 10), (512, 512), (900, 300), (1000, 1000)]:
            expected = ds.read(1, window=((row, row + 1), (col, col + 1)))[0, 0]
            lat, lon = t.cell_center(row, col)
            s = t.sample(lat, lon)
            assert s.status == "cell_value" and s.elevation_m == float(expected)
            # georeferencing: rasterio's own transform agrees with ours
            x, y = ds.xy(row, col)
            assert math.degrees(x / MARS_RADIUS_M) == pytest.approx(lon, abs=1e-9)
            assert math.degrees(y / MARS_RADIUS_M) == pytest.approx(lat, abs=1e-9)


def test_real_tile_metadata_and_resolution():
    t = dem.all_tiles()["jezero"]
    assert t.pixel_m == pytest.approx(463.09, abs=0.01)
    assert t.meta["nodata"] == -32768 and t.coverage()["valid_fraction"] > 0.99
    assert -5500 < t.coverage()["elevation_min_m"] < -4000 and t.coverage()["elevation_max_m"] > 1000


def test_real_jezero_floor_is_below_datum():
    s = dem.find_tile(18.38, 77.58).sample(18.38, 77.58)
    assert -3200 < s.elevation_m < -2200          # Jezero floor lies roughly 2.5 km below the areoid


def test_resolution_disclosure_mentions_limits():
    d = dem.resolution_disclosure(dem.all_tiles()["jezero"])
    assert "NOT resolved" in d["statement"] and d["smallest_resolvable_feature_m"] == pytest.approx(926.2, abs=0.5)
