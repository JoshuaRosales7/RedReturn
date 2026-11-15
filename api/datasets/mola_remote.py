"""On-demand MOLA windows: read only the needed bytes of the global NASA/USGS MOLA 463 m DEM.

The global mosaic (Mars_MGS_MOLA_DEM_mosaic_global_463m.tif, ~2.1 GB) is an *uncompressed* int16 strip TIFF, so the
bytes of any pixel run are located directly from the strip offsets. For a route outside the windows shipped in
api/data/dem we fetch each needed row segment with an HTTP range request (in parallel), verify the TIFF layout we rely
on, and store the window exactly like scripts/build_mola_windows.py does (int16 GeoTIFF + provenance sidecar).

Nothing is resampled, filled or rescaled; nodata (-32768) is preserved. If anything about the source layout differs
from what is verified here, the download is refused rather than guessed.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.transform import Affine

from ..scientific.geodesy import haversine_km

SOURCE_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
RANGE_URL = os.getenv("REDRETURN_MOLA_RANGE_URL", "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif")
ONDEMAND_DIR = Path(os.getenv("REDRETURN_DEM_CACHE_DIR") or Path(__file__).resolve().parent.parent / "data" / "dem" / "ondemand")
RADIUS_M = 3396190.0                     # sphere of the source CRS (Equirectangular Mars)
MARGIN_DEG = 0.6                         # terrain around the route, so detours and slopes at the edge are computable
MIN_HALF_DEG = 1.0
MAX_SPAN_DEG = 3.0                       # longer routes exceed the planner's bounded grid anyway
WORKERS = 24
MAX_CACHED = int(os.getenv("REDRETURN_DEM_CACHE_MAX", "40"))            # stored on-demand areas; the oldest are evicted beyond this
MAX_PER_MIN = int(os.getenv("REDRETURN_DEM_DOWNLOADS_PER_MIN", "6"))   # protects the public NASA/USGS source and this server
_recent: deque[float] = deque()


class RemoteDemError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


def enabled() -> bool:
    return os.getenv("REDRETURN_DEM_ON_DEMAND", "1").lower() not in ("0", "false", "no")


_layout_lock = threading.Lock()
_layout: dict | None = None
_fetch_lock = threading.Lock()


def _get(client: httpx.Client, start: int, length: int) -> bytes:
    for attempt in range(3):
        try:
            r = client.get(RANGE_URL, headers={"Range": f"bytes={start}-{start + length - 1}"})
            if r.status_code == 206 and len(r.content) == length:
                return r.content
        except httpx.HTTPError:
            if attempt == 2:
                raise
    raise RemoteDemError("dem_download_failed", "The MOLA source did not return the requested byte range.")


def _read_layout(client: httpx.Client) -> dict:
    """Parse and verify the TIFF header: size, int16 signed, uncompressed, one sample, strip offsets, georeferencing."""
    head = _get(client, 0, 8)
    if head[:4] != b"II*\x00":
        raise RemoteDemError("dem_source_changed", "Unexpected TIFF header in the MOLA source.")
    ifd = struct.unpack("<I", head[4:])[0]
    n = struct.unpack("<H", _get(client, ifd, 2))[0]
    raw = _get(client, ifd + 2, 12 * n)
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack("<HHII", raw[12 * i:12 * i + 12])
        tags[tag] = (typ, cnt, val)
    short = lambda t: tags[t][2] & 0xFFFF if t in tags else None  # noqa: E731 - SHORT values are left-justified
    expect = {258: 16, 259: 1, 277: 1, 339: 2}                  # 16 bit, uncompressed, 1 sample, signed int
    if any(short(t) != v for t, v in expect.items()) or 273 not in tags:
        raise RemoteDemError("dem_source_changed", "The MOLA source layout changed (expected uncompressed int16 strips); download refused.")
    width, height = tags[256][2], tags[257][2]
    typ, cnt, off = tags[273]
    fmt = "I" if typ == 4 else "Q"
    offsets = struct.unpack(f"<{cnt}{fmt}", _get(client, off, cnt * struct.calcsize(fmt)))
    if cnt != height:
        raise RemoteDemError("dem_source_changed", "Unexpected strip layout in the MOLA source.")
    scale = struct.unpack("<3d", _get(client, tags[33550][2], 24))
    tie = struct.unpack("<6d", _get(client, tags[33922][2], 48))
    meta = client.head(RANGE_URL).headers
    return {"width": width, "height": height, "offsets": offsets, "px": scale[0], "py": scale[1], "x0": tie[3], "y0": tie[4],
            "etag": meta.get("etag"), "last_modified": meta.get("last-modified"), "content_length": meta.get("content-length")}


def _layout_for(client: httpx.Client) -> dict:
    global _layout
    with _layout_lock:
        if _layout is None:
            _layout = _read_layout(client)
        return _layout


def plan_window(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """Lat/lon box (lat_min, lat_max, lon_min, lon_max) to download for a route; raises when the route is too long."""
    lats = [p[0] for p in points]
    lons = [((p[1] + 540) % 360) - 180 for p in points]
    if max(lons) - min(lons) > 180:
        raise RemoteDemError("crosses_antimeridian", "Routes across the 180° meridian are not supported.")
    span = max(max(lats) - min(lats), max(lons) - min(lons))
    if span > MAX_SPAN_DEG:
        km = max(haversine_km(*a, *b) for a in points for b in points)
        raise RemoteDemError("grid_too_large", f"Base and target are {km:,.0f} km apart. RedReturn plans local excursions: both points must be "
                             f"within {MAX_SPAN_DEG:.0f}° of latitude and longitude of each other (about 150–180 km).",
                             {"max_span_deg": MAX_SPAN_DEG, "span_deg": round(span, 3), "km": round(km, 1)})
    clat, clon = (max(lats) + min(lats)) / 2, (max(lons) + min(lons)) / 2
    half = max(MIN_HALF_DEG, span / 2 + MARGIN_DEG)
    clat = min(max(clat, -90 + half), 90 - half)
    clon = min(max(clon, -180 + half), 180 - half)
    return clat - half, clat + half, clon - half, clon + half


def fetch_window(points: list[tuple[float, float]]) -> Path:
    """Download (once) a MOLA window covering the points and return the path of its sidecar JSON."""
    lat_min, lat_max, lon_min, lon_max = plan_window(points)
    with _fetch_lock:                                            # one download at a time; concurrent requests reuse it
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            L = _layout_for(client)
            m_per_deg = RADIUS_M * math.pi / 180
            c0 = int(math.floor((lon_min * m_per_deg - L["x0"]) / L["px"])); c1 = int(math.ceil((lon_max * m_per_deg - L["x0"]) / L["px"]))
            r0 = int(math.floor((L["y0"] - lat_max * m_per_deg) / L["py"])); r1 = int(math.ceil((L["y0"] - lat_min * m_per_deg) / L["py"]))
            c0, r0 = max(0, c0), max(0, r0); c1, r1 = min(L["width"], c1), min(L["height"], r1)
            wid = f"area_{r0}_{c0}_{r1 - r0}x{c1 - c0}"
            sidecar = ONDEMAND_DIR / f"mola_{wid}.json"
            if sidecar.exists():
                return sidecar
            now = time.monotonic()
            while _recent and now - _recent[0] > 60:
                _recent.popleft()
            if len(_recent) >= MAX_PER_MIN:
                raise RemoteDemError("download_rate_limited", f"Too many new areas requested; at most {MAX_PER_MIN} downloads per minute. Try again shortly.",
                                     {"retry_after_s": int(60 - (now - _recent[0])) + 1})
            _recent.append(now)
            w = c1 - c0
            try:
                with ThreadPoolExecutor(WORKERS) as pool:
                    rows = list(pool.map(lambda r: _get(client, L["offsets"][r] + 2 * c0, 2 * w), range(r0, r1)))
            except httpx.HTTPError as e:
                raise RemoteDemError("dem_download_failed", "Could not download MOLA elevations for this area (is the API host online?).",
                                     {"reason": type(e).__name__}) from e
        data = np.frombuffer(b"".join(rows), dtype="<i2").reshape(r1 - r0, w)
        nodata = -32768
        valid = data != nodata
        if not valid.any():
            raise RemoteDemError("nodata", "The MOLA DEM has no data in this area.")
        ONDEMAND_DIR.mkdir(parents=True, exist_ok=True)
        tif = sidecar.with_suffix(".tif")
        with rasterio.open(_REFERENCE_TIF) as ref:
            crs = ref.crs                                           # same source CRS as the shipped windows
        transform = Affine(L["px"], 0, L["x0"] + c0 * L["px"], 0, -L["py"], L["y0"] - r0 * L["py"])
        with rasterio.open(tif, "w", driver="GTiff", dtype="int16", count=1, height=data.shape[0], width=w, crs=crs, transform=transform,
                           nodata=nodata, compress="deflate", predictor=2) as dst:
            dst.write(data, 1)
            dst.update_tags(SOURCE=SOURCE_URL, PRODUCT="MGS MOLA DEM 463m (MEGDR)", VERTICAL_UNITS="metres", VERTICAL_DATUM="MOLA areoid")
        clat, clon = (lat_min + lat_max) / 2, (lon_min + lon_max) / 2
        meta = {
            "id": wid, "name": f"MOLA area {abs(clat):.2f}°{'N' if clat >= 0 else 'S'} {abs(clon):.2f}°{'E' if clon >= 0 else 'W'} (downloaded on demand)",
            "file": tif.name, "sha256": hashlib.sha256(tif.read_bytes()).hexdigest(), "on_demand": True,
            "source": {"dataset": "Mars MGS MOLA DEM 463m (MEGDR derived mosaic)",
                       "organization": "NASA MGS MOLA Science Team; mosaic distributed by USGS Astrogeology",
                       "landing_page": "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m",
                       "download_url": SOURCE_URL, "range_read_url": RANGE_URL,
                       "etag": L["etag"], "last_modified": L["last_modified"], "content_length": L["content_length"]},
            "window": {"col_off": c0, "row_off": r0, "width": w, "height": r1 - r0},
            "pixel_size_m": L["px"], "nodata": float(nodata), "valid_fraction": float(valid.mean()),
            "min_m": int(data[valid].min()), "max_m": int(data[valid].max()),
            "built_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "processing": ["Row segments read via HTTP range requests from the uncompressed global mosaic; no resampling, filling or scaling.",
                           "Downloaded on demand for a user-selected route; stored as int16 deflate GeoTIFF; nodata value preserved."],
        }
        sidecar.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        return sidecar


def evict(keep: Path | None = None) -> list[str]:
    """Delete the oldest downloaded areas beyond MAX_CACHED (never `keep`); returns the evicted window ids."""
    files = sorted(ONDEMAND_DIR.glob("mola_*.json"), key=lambda p: p.stat().st_mtime)
    out = []
    for p in files[:max(0, len(files) - MAX_CACHED)]:
        if keep is not None and p == keep:
            continue
        try:
            wid = json.loads(p.read_text(encoding="utf-8"))["id"]
            p.with_suffix(".tif").unlink(missing_ok=True); p.unlink(missing_ok=True)
            out.append(wid)
        except (OSError, ValueError, KeyError):
            continue
    return out


_REFERENCE_TIF = Path(__file__).resolve().parent.parent / "data" / "dem" / "mola_jezero.tif"


# --- long-range (strategic) grids -----------------------------------------------------------------------------------
COARSE_MAX_CELLS = int(os.getenv("REDRETURN_LONG_RANGE_MAX_CELLS", "80000"))    # ~8–13 MB read for a planet-wide box   # keeps routing bounded (routing.MAX_GRID_CELLS)
_coarse_cache: dict[tuple, dict] = {}


def coarse_window(points: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    """Lat/lon box for a long route: the points plus a margin for detours (15% of the span, at least 1°)."""
    lats = [p[0] for p in points]
    lons = [((p[1] + 540) % 360) - 180 for p in points]
    # The grid never wraps at ±180°: points on opposite sides get a box spanning the long way round, which is still valid.
    m = max(1.0, 0.15 * max(max(lats) - min(lats), max(lons) - min(lons)))
    return max(-89.5, min(lats) - m), min(89.5, max(lats) + m), max(-180.0, min(lons) - m), min(180.0, max(lons) + m)


def fetch_coarse(points: list[tuple[float, float]]) -> dict:
    """Real MOLA values on a regular subsample (every f-th row and column) covering a long route.

    Returns {"z" (float, NaN = nodata), "lat_top", "lon_left", "dlat", "dlon", "factor", "source", "bounds_px"}.
    The cell (i, j) holds the exact source value of pixel (r0 + i·f, c0 + j·f) and is centred on that pixel:
    nothing is averaged, interpolated or filled.
    """
    lat_min, lat_max, lon_min, lon_max = coarse_window(points)
    with _fetch_lock:
        with httpx.Client(timeout=30, follow_redirects=True) as client:
            L = _layout_for(client)
            m_per_deg = RADIUS_M * math.pi / 180
            c0 = max(0, int(math.floor((lon_min * m_per_deg - L["x0"]) / L["px"]))); c1 = min(L["width"], int(math.ceil((lon_max * m_per_deg - L["x0"]) / L["px"])))
            r0 = max(0, int(math.floor((L["y0"] - lat_max * m_per_deg) / L["py"]))); r1 = min(L["height"], int(math.ceil((L["y0"] - lat_min * m_per_deg) / L["py"])))
            f = max(2, math.ceil(math.sqrt((r1 - r0) * (c1 - c0) / COARSE_MAX_CELLS)))
            key = (r0, c0, r1, c1, f)
            if key in _coarse_cache:
                return _coarse_cache[key]
            now = time.monotonic()
            while _recent and now - _recent[0] > 60:
                _recent.popleft()
            if len(_recent) >= MAX_PER_MIN:
                raise RemoteDemError("download_rate_limited", f"Too many new areas requested; at most {MAX_PER_MIN} downloads per minute. Try again shortly.",
                                     {"retry_after_s": int(60 - (now - _recent[0])) + 1})
            _recent.append(now)
            rows = list(range(r0, r1, f))
            try:
                with ThreadPoolExecutor(WORKERS) as pool:
                    raw = list(pool.map(lambda r: _get(client, L["offsets"][r] + 2 * c0, 2 * (c1 - c0)), rows))
            except httpx.HTTPError as e:
                raise RemoteDemError("dem_download_failed", "Could not download MOLA elevations for this area (is the API host online?).",
                                     {"reason": type(e).__name__}) from e
    grid = np.stack([np.frombuffer(b, dtype="<i2")[::f] for b in raw]).astype(np.float64)
    grid[grid == -32768] = np.nan
    if np.isnan(grid).all():
        raise RemoteDemError("nodata", "The MOLA DEM has no data in this area.")
    dlon0, dlat0 = L["px"] / m_per_deg, L["py"] / m_per_deg
    out = {
        "z": grid, "factor": f, "dlon": dlon0 * f, "dlat": dlat0 * f,
        # centre coarse cell (0,0) on source pixel (r0, c0): edge = source centre minus half a coarse cell
        "lon_left": (L["x0"] / m_per_deg) + (c0 + 0.5) * dlon0 - 0.5 * f * dlon0,
        "lat_top": (L["y0"] / m_per_deg) - (r0 + 0.5) * dlat0 + 0.5 * f * dlat0,
        "bounds_px": {"row_off": r0, "col_off": c0, "rows": r1 - r0, "cols": c1 - c0},
        "source": {"dataset": "Mars MGS MOLA DEM 463m (MEGDR derived mosaic)", "range_read_url": RANGE_URL, "etag": L["etag"]},
        "source_pixel_m": L["px"],
    }
    if len(_coarse_cache) >= 6:
        _coarse_cache.pop(next(iter(_coarse_cache)))
    _coarse_cache[key] = out
    return out
