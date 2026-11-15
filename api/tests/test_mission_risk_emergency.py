import pytest

from api.models.schemas import Incident, MissionConfig
from api.scientific import dem, emergency, risk, routing
from api.scientific.mission import G_MARS, RouteSummary, evaluate, flat_summary, summarize_segments

C = MissionConfig()


def test_oxygen_water_energy_accounting():
    r = evaluate(flat_summary(10), C)
    duration = 20 / C.speed_kmh + C.science_hours
    f = 1 + C.contingency_percent / 100
    assert r["duration_hours"] == pytest.approx(duration)
    assert r["oxygen_used_kg"] == pytest.approx(duration * C.crew * C.oxygen_kg_per_person_hour * f)
    assert r["energy_used_kwh"] == pytest.approx(duration * C.energy_kwh_per_hour * f)
    assert r["water_used_liters"] == pytest.approx(duration / 24 * C.crew * C.water_liters_per_person_day * f)


def test_return_trip_doubles_distance_and_can_be_disabled():
    a = evaluate(flat_summary(10), C)
    b = evaluate(flat_summary(10), C.model_copy(update={"return_required": False}))
    assert a["distance_km"] == pytest.approx(2 * b["distance_km"])


def test_reserve_rule_boundary():
    r = evaluate(flat_summary(10), C)
    tight = C.model_copy(update={"oxygen_kg": r["oxygen_used_kg"] / 0.8 * 0.999})   # reserve 20% just violated
    ok = C.model_copy(update={"oxygen_kg": r["oxygen_used_kg"] / 0.8 * 1.001})
    assert evaluate(flat_summary(10), tight)["constraints"]["oxygen"] is False
    assert evaluate(flat_summary(10), ok)["constraints"]["oxygen"] is True


def test_impossible_missions():
    assert evaluate(flat_summary(10), C.model_copy(update={"oxygen_kg": 0, "energy_kwh": 0}))["feasible_within_model"] is False
    assert evaluate(flat_summary(1000), C)["constraints"]["time"] is False
    assert evaluate(flat_summary(10), C.model_copy(update={"max_radiation_msv": 0.001}))["constraints"]["radiation"] is False


def test_climb_energy_physics_and_slope_derating():
    s = summarize_segments([1000.0], [100.0], 15.0)        # 100 m climb over 1 km
    assert s.ascent_out_m == 100 and s.effective_km > s.one_way_km
    r = evaluate(s, C.model_copy(update={"return_required": False}))
    expected_climb = C.rover_mass_kg * G_MARS * 100 / C.drivetrain_efficiency / 3.6e6
    assert r["climb_energy_kwh"] == pytest.approx(expected_climb)


def test_terrain_changes_result_vs_flat():
    flat = evaluate(flat_summary(10), C)
    hill = evaluate(summarize_segments([10000 / 10] * 10, [60.0] * 10, 15), C)
    assert hill["duration_hours"] > flat["duration_hours"] and hill["energy_used_kwh"] > flat["energy_used_kwh"]


def test_limiting_factor_identified():
    r = evaluate(flat_summary(10), C.model_copy(update={"max_hours": 5}))
    assert r["limiting_factor"] == "time"


# ---- Monte Carlo ------------------------------------------------------------------------
S = RouteSummary(22.0, 22.5, 190, 30, True)


def test_monte_carlo_reproducible_and_seed_sensitive():
    a, b = risk.analyze(S, C, runs=500, seed=7), risk.analyze(S, C, runs=500, seed=7)
    c = risk.analyze(S, C, runs=500, seed=8)
    assert a["result_sha256"] == b["result_sha256"] and a["result_sha256"] != c["result_sha256"]


def test_monte_carlo_labelling_never_claims_survival_probability():
    r = risk.analyze(S, C, runs=300)
    assert "NOT an empirically validated probability" in r["label"] and "survival" not in " ".join(r.keys()).lower()
    lo, hi = r["monte_carlo_sampling_interval_95"]["low"], r["monte_carlo_sampling_interval_95"]["high"]
    assert lo <= r["fraction_satisfying_constraints"] <= hi


def test_sensitivity_identifies_dominant_input_for_time_limited_mission():
    tight = C.model_copy(update={"max_hours": 13.0})
    r = risk.analyze(S, tight, runs=1500)
    assert r["sensitivity"][0]["name"] in ("speed_factor", "terrain_time_factor")
    assert r["dominant_failure_mode"] == "time"


def test_more_uncertainty_widens_margin_spread():
    narrow = risk.analyze(S, C, runs=1500, sigma_overrides={"speed_factor": 0.02}, with_sensitivity=False)
    wide = risk.analyze(S, C, runs=1500, sigma_overrides={"speed_factor": 0.30}, with_sensitivity=False)
    spread = lambda r: r["distributions"]["limiting_margin_percent"]["p90"] - r["distributions"]["limiting_margin_percent"]["p10"]  # noqa: E731
    assert spread(wide) > spread(narrow)


def test_quantiles_ordered_and_decomposition_present():
    r = risk.analyze(S, C, runs=600)
    q = r["distributions"]["duration_hours"]
    assert q["p10"] <= q["p50"] <= q["p90"] and set(r["uncertainty_decomposition"]) == {"measurement", "model", "scenario"}


# ---- Emergency ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def planned():
    tile = dem.all_tiles()["jezero"]
    mob = routing.Mobility.from_config(C)
    a, b = (18.38, 77.58), (18.6, 77.2)
    return tile, routing.optimised_route(tile, "terrain", a, b, mob), mob, a, b


def sim(planned, incidents, progress=0.6):
    tile, route, mob, a, b = planned
    return emergency.simulate(tile, route, C, mob, "terrain", incidents, progress, base=a, dest=b)


def test_zero_magnitude_incident_reproduces_original(planned):
    out = sim(planned, [Incident(kind="travel_delay", magnitude=0)])
    assert out["failure"]["total_hours"] == pytest.approx(out["original"]["total_hours"], rel=1e-6)
    assert out["failure"]["oxygen_remaining_kg"] == pytest.approx(out["original"]["oxygen_remaining_kg"], rel=1e-6)
    assert out["failure"]["energy_remaining_kwh"] == pytest.approx(out["original"]["energy_remaining_kwh"], rel=1e-6)


def test_battery_failure_triggers_recalculation_and_revised_plan(planned):
    out = sim(planned, [Incident(kind="battery_loss", magnitude=35), Incident(kind="speed_reduction", magnitude=30)])
    assert out["original"]["feasible_within_model"] and not out["failure"]["feasible_within_model"]
    assert out["revised"]["id"] == "abort_to_base" and out["revised"]["feasible_within_model"]
    assert out["failure"]["energy_remaining_kwh"] < out["original"]["energy_remaining_kwh"]
    assert out["unavoidable_uncertainty"] and out["diff"][0]["cause"]


def test_infeasible_everywhere_reports_required_additional_resources(planned):
    out = sim(planned, [Incident(kind="battery_loss", magnitude=95)], 0.9)
    assert out["revised_feasible"] is False and out["revised"]["required_additional"]["energy_kwh"] > 0


def test_obstruction_blocks_original_path_and_replans(planned):
    out = sim(planned, [Incident(kind="route_obstruction", magnitude=3)], 0.3)
    ids = {o["id"]: o for o in out["options"]}
    assert ids["continue_as_planned"]["status"] == "blocked" and ids["abort_to_base"]["status"] in ("ok", "blocked")


def test_comms_reduction_is_flagged_as_assumption(planned):
    out = sim(planned, [Incident(kind="comms_reduction", magnitude=50)])
    assert any("ASSUMPTION" in s for s in out["incident"]["applied"])
