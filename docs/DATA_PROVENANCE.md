# Data provenance

Classification used in the UI (Reports → Data sources): **A** direct observation / gridded instrument product · **B** derived calculation · **C** model assumption · **D** simulation output · **E** missing data.

## The numeric dataset (class A): MOLA DEM 463 m
| Field | Value |
|---|---|
| Name | Mars MGS MOLA DEM 463 m (MEGDR-derived global mosaic) |
| Organisation | NASA MGS MOLA Science Team; mosaic distributed by USGS Astrogeology |
| Landing page | https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m |
| File | `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif` (2,125,771,142 bytes; ETag `cccf7001294ee9f503b13318eab83086-254`; Last-Modified 2022-11-10) |
| Format | GeoTIFF, int16, 46080×23040, nodata −32768, one-row strips |
| Georeferencing | Equirectangular, centre meridian 0°, standard parallel 0°, **sphere radius 3,396,190 m**, east-positive longitude, pixel 463.0935 m = 1/128° |
| Vertical | metres relative to the MOLA areoid; total uncertainty ≥ ±3 m (USGS) |
| Licence | Public domain (NASA/USGS); cite the MOLA team |
| Access method | `scripts/build_mola_windows.py` reads only the needed pixels via HTTP range requests (GDAL `/vsicurl/`). No resampling, filling or scaling. |
| Cached windows | `api/data/dem/mola_jezero.tif` (14.38–22.38°N, 73.58–81.59°E) and `mola_gale.tif` (9.41–1.40°S, 133.80–141.81°E): 1025×1025 cells, ~1 MB each, 0 nodata cells. Each has a sidecar JSON with source ETag, window offsets, value range and SHA-256. |
| Integrity | `GET /api/datasets/status` recomputes checksums at runtime. |

Rebuild: `.venv/bin/python scripts/build_mola_windows.py` (needs network, ~45 s).

## Display layers (class A, never used as data)
NASA Mars Trek WMTS, level-0 tiles; each layer's two tiles returned HTTP 200 with `Access-Control-Allow-Origin: *` on 2026-11-14:
`Mars_MGS_MOLA_ClrShade_merge_global_463m` (jpg), `Mars_Viking_MDIM21_ClrMosaic_global_232m` (jpg), `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`, `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`, `TES_Thermal_Inertia` (png). Pattern: `https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/0/0/{col}.{ext}`. Colours are never converted to numbers.

## Assumptions (class C)
Radiation rate 0.025 mSv/h ≈ 0.6 mSv/day, anchored on the published MSL RAD surface result (Hassler et al., 2014, *Science* 343:1244797; ≈0.64 mSv/day; Gale Crater). The 1 mSv limit, 15° slope cap, 1,500 kg rover, 0.6 drivetrain efficiency, crew rates, battery/O₂/water loads, speed 4.5 km/h, 20 % reserve, 15 % contingency are **editable scenario values**, not vehicle or regulatory data.

## Derived (class B)
Bilinear elevation (flagged `interpolated`), Horn slope (463 m baseline), along-track slope, ascent/descent, slope-derated effective distance, routes, resource totals.

## Simulated (class D)
Monte Carlo ensembles and emergency scenarios.

## Missing (class E, shown as unavailable)
USGS Gazetteer (catalog coordinates are approximate and curated), HiRISE/CTX DTMs and imagery, rock/boulder abundance, soil bearing strength, space-weather events, local atmosphere/temperature, communications geometry.
