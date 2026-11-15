"""Current conditions from NASA services: space-weather notifications (CCMC DONKI) and rover surface imagery.

Both are context for the crew, never inputs to the deterministic mission model. Responses are cached so the public
NASA services (and the DEMO_KEY rate limit of api.nasa.gov) are not hit on every page view.
"""
from __future__ import annotations

import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from ..errors import ApiError
from ..scientific.geodesy import haversine_km

DONKI_URL = "https://api.nasa.gov/DONKI/notifications"
M2020_URL = "https://mars.nasa.gov/rss/api/"
MSL_URL = "https://mars.nasa.gov/api/v1/raw_image_items/"
SPACE_WEATHER_TTL_S = 3 * 3600
IMAGES_TTL_S = 6 * 3600

# Message types that can concern Mars. RBE (Earth's radiation belts) and GST (geomagnetic storms) describe Earth only.
MARS_RELEVANT = {"FLR": "Solar flare", "SEP": "Solar energetic particles", "CME": "Coronal mass ejection",
                 "IPS": "Interplanetary shock", "MPC": "Magnetopause crossing", "Report": "Weekly space weather report"}
EARTH_ONLY = {"RBE": "Earth radiation belt enhancement", "GST": "Geomagnetic storm (Earth)"}

# Rover operating regions (approximate centres; radius covers the traverse area). Images are from somewhere in the
# region on recent sols — the feeds do not give the rover's coordinates, so they are never placed on the map.
ROVERS = [
    {"id": "perseverance", "name": "Perseverance", "region": "Jezero crater", "lat": 18.44, "lon": 77.45, "radius_km": 150,
     "credit": "NASA/JPL-Caltech"},
    {"id": "curiosity", "name": "Curiosity", "region": "Gale crater / Mount Sharp", "lat": -4.59, "lon": 137.44, "radius_km": 150,
     "credit": "NASA/JPL-Caltech/MSSS"},
]

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()


def _cached(key: str, ttl: float, fn):
    with _lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
    value = fn()
    with _lock:
        _cache[key] = (time.monotonic(), value)
    return value


def _fetch_json(url: str, params: dict) -> object:
    try:
        r = httpx.get(url, params=params, timeout=25, follow_redirects=True, headers={"User-Agent": "RedReturn (educational Mars planning tool)"})
    except httpx.HTTPError as e:
        raise ApiError(502, "upstream_unavailable", "The NASA service did not answer.", {"service": url, "reason": type(e).__name__}) from e
    if r.status_code == 429:
        raise ApiError(503, "upstream_rate_limited", "The NASA service rate limit was reached; try again later.", {"service": url})
    if r.status_code != 200:
        raise ApiError(502, "upstream_unavailable", f"The NASA service answered HTTP {r.status_code}.", {"service": url})
    return r.json()


def _summary(body: str) -> str:
    m = re.search(r"##\s*Summary:\s*(.+?)(?:\n##|\Z)", body, re.S)
    text = re.sub(r"\s+", " ", (m.group(1) if m else body)).strip()
    return text[:420] + ("…" if len(text) > 420 else "")


def _mentions_mars(body: str) -> bool:
    """True when the notification names Mars itself — not just NASA's "Moon to Mars Space Weather Analysis Office"."""
    return bool(re.search(r"\bMars\b", re.sub(r"Moon\s+to\s+Mars", "", body, flags=re.I)))


def space_weather(days: int = 30) -> dict:
    def load() -> dict:
        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=days)
        raw = _fetch_json(DONKI_URL, {"startDate": start.isoformat(), "endDate": end.isoformat(), "type": "all",
                                      "api_key": os.getenv("NASA_API_KEY", "DEMO_KEY")})
        items, excluded = [], {}
        for n in raw if isinstance(raw, list) else []:
            t = n.get("messageType", "")
            if t in EARTH_ONLY:
                excluded[t] = excluded.get(t, 0) + 1
                continue
            body = n.get("messageBody", "") or ""
            items.append({"type": t, "label": MARS_RELEVANT.get(t, t), "issued": n.get("messageIssueTime"), "url": n.get("messageURL"),
                          "mentions_mars": _mentions_mars(body), "summary": _summary(body)})
        items.sort(key=lambda x: x["issued"] or "", reverse=True)
        return {"source": "NASA Community Coordinated Modeling Center — DONKI notifications (api.nasa.gov)", "window_days": days,
                "start": start.isoformat(), "end": end.isoformat(), "items": items,
                "excluded_earth_only": [{"type": k, "label": EARTH_ONLY[k], "count": v} for k, v in excluded.items()],
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "note": ("Notifications are issued for the inner heliosphere as seen from Earth. Whether an event reaches Mars depends on "
                         "where Mars is relative to the eruption; items that mention Mars are flagged. RedReturn's dose model still uses "
                         "the published average surface rate — these notifications never change a calculated number.")}
    return _cached(f"sw:{days}", SPACE_WEATHER_TTL_S, load)


def _m2020(n: int) -> list[dict]:
    raw = _fetch_json(M2020_URL, {"feed": "raw_images", "category": "mars2020", "feedtype": "json", "num": 80, "page": 0, "order": "sol desc"})
    keep = ("MCZ_", "NAVCAM", "FRONT_HAZCAM", "REAR_HAZCAM")
    out = []
    for im in raw.get("images", []) if isinstance(raw, dict) else []:
        inst = (im.get("camera") or {}).get("instrument", "")
        if not inst.startswith(keep):
            continue
        files = im.get("image_files") or {}
        url = files.get("medium") or files.get("small")
        if url:
            out.append({"url": url, "full_url": files.get("full_res") or url, "sol": im.get("sol"), "camera": inst.replace("_", " ").title(),
                        "taken_utc": im.get("date_taken_utc"), "title": im.get("title"), "credit": im.get("credit") or "NASA/JPL-Caltech",
                        "page": im.get("link")})
    return out[:n]


def _msl(n: int) -> list[dict]:
    raw = _fetch_json(MSL_URL, {"order": "sol desc", "per_page": 60, "page": 0, "condition_1": "msl:mission"})
    out = []
    for it in raw.get("items", []) if isinstance(raw, dict) else []:
        url = it.get("https_url") or it.get("url")
        if not url or it.get("is_thumbnail"):
            continue
        out.append({"url": url, "full_url": url, "sol": it.get("sol"), "camera": (it.get("instrument") or "").replace("_", " ").title(),
                    "taken_utc": it.get("date_taken"), "title": it.get("title"), "credit": it.get("image_credit") or "NASA/JPL-Caltech/MSSS",
                    "page": f"https://mars.nasa.gov{it['link']}" if str(it.get("link", "")).startswith("/") else it.get("link")})
    return out[:n]


def surface_images(lat: float, lon: float, n: int = 8) -> dict:
    near = sorted(((haversine_km(lat, lon, r["lat"], r["lon"]), r) for r in ROVERS), key=lambda x: x[0])
    dist, rover = near[0]
    if dist > rover["radius_km"]:
        return {"rover": None, "images": [], "nearest": {"name": rover["name"], "region": rover["region"], "distance_km": round(dist)},
                "note": "No NASA rover operates near this location, so there are no ground-level images for it."}
    images = _cached(f"img:{rover['id']}:{n}", IMAGES_TTL_S, lambda: _m2020(n) if rover["id"] == "perseverance" else _msl(n))
    return {"rover": {k: rover[k] for k in ("id", "name", "region", "credit")}, "distance_km": round(dist), "images": images,
            "note": (f"Latest raw images from {rover['name']} in {rover['region']}. They show the kind of ground you will meet, "
                     "taken somewhere in the region on recent sols — not at your waypoints (the feed gives no rover position). "
                     "Raw, unprocessed images: colours and exposure are not calibrated.")}
