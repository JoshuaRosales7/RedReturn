"""Generate golden vectors from the Python engine; the TypeScript mirror must reproduce them (tests/parity.test.ts)."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from api.models.schemas import MissionConfig  # noqa: E402
from api.scientific.geodesy import haversine_km, normalize_lon  # noqa: E402
from api.scientific.mission import RouteSummary, evaluate  # noqa: E402

CASES = {
    "default_flat_10km": (RouteSummary(10, 10, 0, 0, False), {}),
    "default_terrain": (RouteSummary(22.0, 24.5, 190.0, 30.0, True), {}),
    "tight_oxygen": (RouteSummary(15, 16, 80, 40, True), {"oxygen_kg": 2.5}),
    "time_limited": (RouteSummary(30, 33, 300, 120, True), {"max_hours": 14}),
    "one_way": (RouteSummary(12, 12.5, 100, 20, True), {"return_required": False, "crew": 3}),
    "impossible": (RouteSummary(10, 10, 0, 0, False), {"oxygen_kg": 0, "energy_kwh": 0}),
}
GEO = [(0, 0, 0, 1), (0, 179, 0, -179), (18.38, 77.58, 18.6, 77.2), (90, 0, 90, 170), (-45, 10, 30, -170)]


def main() -> None:
    out = {"mission": {}, "geodesy": [], "normalize_lon": [[v, normalize_lon(v)] for v in (190, -190, 360, 180, -180, 540, 0)]}
    for name, (route, patch) in CASES.items():
        cfg = MissionConfig(**patch)
        r = evaluate(route, cfg)
        out["mission"][name] = {"route": route.__dict__, "config": patch,
                                "expected": {k: r[k] for k in ("distance_km", "duration_hours", "oxygen_used_kg", "energy_used_kwh",
                                                               "water_used_liters", "radiation_msv", "oxygen_remaining_kg", "energy_remaining_kwh",
                                                               "water_remaining_liters", "limiting_factor", "feasible_within_model")}}
    out["geodesy"] = [{"a": [a, b], "b": [c, d], "km": haversine_km(a, b, c, d)} for a, b, c, d in GEO]
    path = Path(__file__).resolve().parent.parent / "tests" / "golden" / "mission_vectors.json"
    path.write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    print("wrote", path)


if __name__ == "__main__":
    main()
