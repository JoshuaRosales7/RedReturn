"""Dataset provenance catalogue. Every scientific layer states source, resolution, units, processing, limits."""
from __future__ import annotations

import hashlib
import json

from ..scientific import dem

# Classification vocabulary exposed to the UI
CLASSES = {
    "A": "Direct observation (or gridded product derived directly from instrument data)",
    "B": "Derived calculation (computed by RedReturn from A)",
    "C": "Model assumption (editable scenario parameter)",
    "D": "Simulation output (hypothetical ensemble or incident what-if)",
    "E": "Missing data (not integrated; shown as unavailable)",
}

TREK = "https://trek.nasa.gov/tiles/Mars/EQ"
VERIFIED = "2026-11-14"


def _layers() -> list[dict]:
    return [
        {"id": "mola-dem-463m", "class": "A", "kind": "topographic", "name": "MGS MOLA DEM 463 m (MEGDR-derived), local windows",
         "organization": "NASA MGS MOLA Science Team; mosaic by USGS Astrogeology",
         "url": "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m",
         "identifier": "Mars_MGS_MOLA_DEM_mosaic_global_463m.tif", "units": "metres above MOLA areoid (int16)",
         "resolution_m": 463.09, "vertical_uncertainty_m": 3.0,
         "processing": ["Windowed HTTP range read; no resampling/filling/scaling.", "Bilinear interpolation at query points (flagged)."],
         "limitations": ["Features < ~1 km are unresolved.", "Only cached windows are covered (see /api/terrain/coverage)."],
         "license": "Public domain (NASA/USGS); cite authors.", "integration": "numeric, used in routing and mission model"},
        {"id": "mola-colorshade", "class": "A", "kind": "topographic-visual", "name": "MOLA colorized shaded relief (WMTS)",
         "organization": "NASA JPL Mars Trek", "url": f"{TREK}/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{{z}}/{{row}}/{{col}}.jpg",
         "identifier": "Mars_MGS_MOLA_ClrShade_merge_global_463m", "units": "none (colour image, NOT elevation)", "resolution_m": 463,
         "processing": ["Tiles displayed as served."], "limitations": ["Visual only; pixel colour must never be read as elevation."],
         "license": "NASA media usage guidelines", "integration": "display only", "verified": VERIFIED},
        {"id": "viking-mdim21", "class": "A", "kind": "optical", "name": "Viking MDIM 2.1 colorized mosaic (WMTS)",
         "organization": "USGS / NASA Mars Trek", "url": f"{TREK}/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{{z}}/{{row}}/{{col}}.jpg",
         "identifier": "Mars_Viking_MDIM21_ClrMosaic_global_232m", "units": "none (image)", "resolution_m": 232,
         "processing": ["Displayed as served."], "limitations": ["Mosaic colour is processed; not for quantitative albedo."],
         "license": "NASA media usage guidelines", "integration": "display only", "verified": VERIFIED},
        {"id": "themis-day-ir", "class": "A", "kind": "thermal", "name": "THEMIS Day IR controlled mosaic 100 m (WMTS)",
         "organization": "Mars Odyssey THEMIS / ASU via NASA Mars Trek",
         "url": f"{TREK}/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/default/default028mm/{{z}}/{{row}}/{{col}}.png",
         "identifier": "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", "units": "none (radiance image)", "resolution_m": 100,
         "processing": ["Displayed as served."], "limitations": ["Brightness is not a calibrated temperature in this app."],
         "license": "NASA media usage guidelines", "integration": "display only", "verified": VERIFIED},
        {"id": "tes-thermal-inertia", "class": "A", "kind": "thermal", "name": "MGS TES thermal inertia (WMTS)",
         "organization": "MGS TES via NASA Mars Trek", "url": f"{TREK}/TES_Thermal_Inertia/1.0.0/default/default028mm/{{z}}/{{row}}/{{col}}.png",
         "identifier": "TES_Thermal_Inertia", "units": "none (colour image)", "resolution_m": None,
         "processing": ["Displayed as served."], "limitations": ["Coarse (~km) footprint; surface-property proxy only."],
         "license": "NASA media usage guidelines", "integration": "display only", "verified": VERIFIED},
        {"id": "msl-rad-dose", "class": "C", "kind": "radiation", "name": "Surface radiation rate (scenario parameter)",
         "organization": "Anchored on MSL RAD published result, Hassler et al. 2014, Science 343:1244797 (~0.64 mSv/day)",
         "url": "https://doi.org/10.1126/science.1244797", "identifier": "doi:10.1126/science.1244797", "units": "mSv/h (editable)",
         "resolution_m": None, "processing": ["Converted to 0.025 mSv/h default; user-editable."],
         "limitations": ["Gale Crater measurement; no solar-particle-event or location dependence modelled.",
                         "The 1 mSv mission limit is a scenario value, not a regulatory limit."],
         "license": "n/a (literature value)", "integration": "model assumption"},
        {"id": "crew-rates", "class": "C", "kind": "life-support", "name": "Crew oxygen/water rates and rover power (scenario parameters)",
         "organization": "RedReturn defaults (educational)", "url": None, "identifier": "MissionConfig defaults", "units": "kg/person/h, L/person/day, kWh/h",
         "resolution_m": None, "processing": ["Constant rates × duration × contingency."], "limitations": ["Not vehicle or EVA-suit data."],
         "license": "n/a", "integration": "model assumption"},
        {"id": "usgs-gazetteer", "class": "E", "kind": "nomenclature", "name": "USGS Planetary Gazetteer (named features)",
         "organization": "USGS / IAU WGPSN", "url": "https://planetarynames.wr.usgs.gov/", "identifier": "Mars nomenclature",
         "units": "degrees", "resolution_m": None, "processing": [], "limitations": ["Catalogued, not mounted; landmark list is curated – verify before use."],
         "license": "Public", "integration": "not integrated"},
        {"id": "hirise-ctx", "class": "E", "kind": "optical-high-res", "name": "MRO HiRISE / CTX imagery and DTMs",
         "organization": "NASA MRO / University of Arizona / MSSS", "url": "https://www.uahirise.org/", "identifier": "HiRISE, CTX",
         "units": "image/DTM", "resolution_m": 0.3, "processing": [], "limitations": ["Not integrated: needed for rover-scale hazards."],
         "license": "Public", "integration": "not integrated (blocker: size/time)"},
        {"id": "hazard-rocks", "class": "E", "kind": "hazard", "name": "Rock abundance / boulder hazard map",
         "organization": "n/a", "url": None, "identifier": None, "units": None, "resolution_m": None, "processing": [],
         "limitations": ["Missing: rock/obstacle avoidance is NOT modelled."], "license": "n/a", "integration": "missing"},
    ]


def provenance() -> dict:
    return {"classification": CLASSES, "layers": _layers()}


def status() -> dict:
    tiles = []
    for p in dem.sidecars():
        meta = json.loads(p.read_text(encoding="utf-8"))
        tif = p.with_name(meta["file"])
        ok = tif.exists() and hashlib.sha256(tif.read_bytes()).hexdigest() == meta["sha256"]
        tiles.append({"id": meta["id"], "name": meta["name"], "file": meta["file"], "checksum_ok": ok,
                      "source_etag": meta["source"]["etag"], "source_last_modified": meta["source"]["last_modified"],
                      "built_at_utc": meta["built_at_utc"], "valid_fraction": meta["valid_fraction"],
                      "elevation_range_m": [meta["min_m"], meta["max_m"]]})
    loaded = dem.all_tiles()
    return {"items": [{"id": "mola-dem-463m", "status": "mounted" if tiles and all(t["checksum_ok"] for t in tiles) else "degraded",
                       "purpose": "numeric elevation", "windows": tiles, "loaded_windows": sorted(loaded)},
                      {"id": "mars-trek-wmts", "status": "configured", "purpose": "visual layers (client-side)"},
                      {"id": "hirise-ctx", "status": "not-integrated", "purpose": "rover-scale hazards"}],
            "checked_at": None}
