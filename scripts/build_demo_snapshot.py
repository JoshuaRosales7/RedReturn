"""Precompute the demo scenario with the real API engine and store it as a static snapshot.

The static web app falls back to this snapshot (clearly labelled) when the API is unreachable, so a live
demonstration survives a network failure without duplicating scientific logic in TypeScript.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402

client = TestClient(app)
demo = client.get("/api/demo").json()
body = {k: demo[k] for k in ("origin", "destination", "science_stops", "config")}


def post(path, extra=None):
    r = client.post(path, json={**body, **(extra or {})})
    r.raise_for_status()
    return r.json()


QUESTIONS = ["Why is this route preferable?", "What happens if battery capacity drops by 25%?", "How much additional oxygen would the mission require?",
             "Which assumption contributes the most uncertainty?", "What evidence supports this terrain classification?",
             "Which parts of the route lack adequate scientific data?", "What changes improve modeled return margins?", "Why can the system not certify this mission?"]
alt = post("/api/routes/alternatives")
rec = alt["recommended"] or "terrain"
incident = demo["incident"]
snapshot = {
    "snapshot": {"generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                 "git_commit": subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip() or None,
                 "note": "Precomputed by the RedReturn API engine for the demo scenario. Not live."},
    "demo": demo, "alternatives": alt,
    "risk": post("/api/risk/analyze", {"strategy": rec, "runs": demo["runs"], "seed": demo["seed"]}),
    "scenario": post("/api/scenarios/simulate", {"strategy": rec, "incidents": incident["kinds"], "at_progress": incident["at_progress"]}),
    "ares": {q: post("/api/ares/ask", {"question": q, "strategy": rec}) for q in QUESTIONS},
    "heightfield": client.get("/api/terrain/heightfield", params={"tile": "jezero", "lat_min": 17.9, "lat_max": 18.9, "lon_min": 76.9, "lon_max": 78.0, "max_size": 128}).json(),
    "datasets": client.get("/api/datasets").json(),
    "coverage": client.get("/api/terrain/coverage").json(),
}
out = ROOT / "public" / "data" / "demo-snapshot.json"
out.write_text(json.dumps(snapshot, separators=(",", ":")))
print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KiB); recommended={rec}")
