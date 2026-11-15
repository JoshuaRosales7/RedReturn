import math

import pytest

from api.scientific.geodesy import (MARS_RADIUS_KM, haversine_km, initial_bearing, interpolate_great_circle,
                                    normalize_lon, polyline_km)


def test_identical_points_zero():
    assert haversine_km(10, 20, 10, 20) == 0


def test_one_degree_on_equator():
    assert haversine_km(0, 0, 0, 1) == pytest.approx(MARS_RADIUS_KM * math.pi / 180, rel=1e-12)


def test_antimeridian_short_arc():
    assert haversine_km(0, 179, 0, -179) == pytest.approx(2 * MARS_RADIUS_KM * math.pi / 180, rel=1e-9)
    assert haversine_km(0, 179, 0, 181) == pytest.approx(haversine_km(0, 179, 0, -179))


def test_pole_longitude_irrelevant():
    assert haversine_km(90, 0, 90, 170) < 1e-6
    assert haversine_km(90, 0, -90, 0) == pytest.approx(math.pi * MARS_RADIUS_KM)


@pytest.mark.parametrize("raw,expected", [(190, -170), (-190, 170), (360, 0), (180, -180), (-180, -180), (540, -180), (0, 0)])
def test_normalize_lon(raw, expected):
    assert normalize_lon(raw) == pytest.approx(expected)


def test_interpolation_endpoints_and_monotone_distance():
    pts = interpolate_great_circle(10, 179, 12, -179, 10)
    assert pts[0] == (10, 179) and pts[-1] == (12, 181 - 360)
    assert all(math.isfinite(a + b) for a, b in pts)
    assert polyline_km(pts) == pytest.approx(haversine_km(10, 179, 12, -179), rel=1e-6)


def test_polar_interpolation_finite():
    pts = interpolate_great_circle(89.5, 0, 89.5, 180, 8)
    assert all(math.isfinite(a + b) for a, b in pts)


def test_bearing_cardinal():
    assert initial_bearing(0, 0, 0, 10) == pytest.approx(90)
    assert initial_bearing(0, 0, 10, 0) == pytest.approx(0)
