"""Cut small, reproducible windows from the NASA/USGS MOLA MEGDR 463 m DEM.

Source product: Mars MGS MOLA DEM 463 m (USGS Astrogeology, derived from the
PDS MEGDR). The global GeoTIFF is ~2.1 GB, so this script reads only the
requested window with HTTP range requests (GDAL /vsicurl/) and stores it as a
compressed int16 GeoTIFF plus a provenance sidecar JSON.

Nothing is resampled, filled or rescaled: pixel values are the source int16
elevations in metres relative to the MOLA areoid; nodata (-32768) is preserved.

Usage:  .venv/bin/python scripts/build_mola_windows.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

SOURCE_URL = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
RANGE_URL = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
OUT_DIR = Path(__file__).resolve().parent.parent / "api" / "data" / "dem"

# id -> (name, centre lat, centre lon, half-size in degrees)
WINDOWS = {
    "jezero": ("Jezero Crater region", 18.38, 77.58, 4.0),
    "gale": ("Gale Crater / Aeolis Mons region", -5.40, 137.80, 4.0),
}


def deg_to_window(ds: rasterio.DatasetReader, lat: float, lon: float, half_deg: float) -> Window:
    # Source CRS is equirectangular on a 3,396,190 m sphere, centre meridian 0, east-positive.
    radius = 3396190.0
    m_per_deg = radius * np.pi / 180.0
    x0, x1 = (lon - half_deg) * m_per_deg, (lon + half_deg) * m_per_deg
    y0, y1 = (lat - half_deg) * m_per_deg, (lat + half_deg) * m_per_deg
    col0, row0 = ~ds.transform * (x0, y1)
    col1, row1 = ~ds.transform * (x1, y0)
    col0, row0 = int(np.floor(col0)), int(np.floor(row0))
    col1, row1 = int(np.ceil(col1)), int(np.ceil(row1))
    return Window(col0, row0, col1 - col0, row1 - row0)


def etag_and_modified() -> dict:
    req = urllib.request.Request(RANGE_URL, method="HEAD")
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - fixed https URL
        return {
            "etag": resp.headers.get("ETag"),
            "last_modified": resp.headers.get("Last-Modified"),
            "content_length": resp.headers.get("Content-Length"),
        }


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    remote = etag_and_modified()
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
        with rasterio.open(f"/vsicurl/{RANGE_URL}") as ds:
            for wid, (name, lat, lon, half) in WINDOWS.items():
                win = deg_to_window(ds, lat, lon, half)
                data = ds.read(1, window=win)
                transform = ds.window_transform(win)
                profile = {
                    "driver": "GTiff", "dtype": "int16", "count": 1, "height": data.shape[0],
                    "width": data.shape[1], "crs": ds.crs, "transform": transform,
                    "nodata": ds.nodata, "compress": "deflate", "predictor": 2, "zlevel": 9,
                    "tiled": False,
                }
                tif = OUT_DIR / f"mola_{wid}.tif"
                with rasterio.open(tif, "w", **profile) as dst:
                    dst.write(data, 1)
                    dst.update_tags(
                        SOURCE=SOURCE_URL, PRODUCT="MGS MOLA DEM 463m (MEGDR)",
                        VERTICAL_UNITS="metres", VERTICAL_DATUM="MOLA areoid",
                    )
                valid = data != ds.nodata
                meta = {
                    "id": wid, "name": name, "file": tif.name,
                    "sha256": hashlib.sha256(tif.read_bytes()).hexdigest(),
                    "source": {
                        "dataset": "Mars MGS MOLA DEM 463m (MEGDR derived mosaic)",
                        "organization": "NASA MGS MOLA Science Team; mosaic distributed by USGS Astrogeology",
                        "landing_page": "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m",
                        "download_url": SOURCE_URL,
                        "range_read_url": RANGE_URL,
                        **remote,
                    },
                    "window": {"col_off": win.col_off, "row_off": win.row_off, "width": win.width, "height": win.height},
                    "pixel_size_m": ds.res[0],
                    "nodata": ds.nodata,
                    "valid_fraction": float(valid.mean()),
                    "min_m": int(data[valid].min()), "max_m": int(data[valid].max()),
                    "built_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "processing": [
                        "Windowed read via HTTP range requests; no resampling, filling or scaling.",
                        "Stored as int16 deflate GeoTIFF; nodata value preserved.",
                    ],
                }
                (OUT_DIR / f"mola_{wid}.json").write_text(json.dumps(meta, indent=2) + "\n")
                print(f"{wid}: {data.shape} valid={meta['valid_fraction']:.4f} "
                      f"range=[{meta['min_m']},{meta['max_m']}] m, {tif.stat().st_size/1024:.0f} KiB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
