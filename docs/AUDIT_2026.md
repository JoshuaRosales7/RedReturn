# RedReturn repository audit — 2026-11-14

**Baseline:** `https://github.com/JoshuaRosales7/RedReturn` cloned into an empty working directory at commit `502d9ef` ("Improve RedReturn mission planning experience"), clean tree. Work was done on branch `feature/mission-decision-intelligence`. Nothing unrelated was overwritten (no prior local work existed).

**Method:** read every source file listed in the brief plus CI, Docker, env and deployment files; ran Python against the DEM and API; compared TS and Python implementations. Baseline tests were **not executed before modification** (the repo's own `docs/VERIFICATION.md` claims 8/8 Vitest and says Python tests were never run); post-change results are in `VERIFICATION.md`.

Status legend: **Fixed** (verified by a test or browser check), **Mitigated**, **Open**.

## Findings

| # | Severity | Finding (evidence) | Status |
|---|---|---|---|
| 1 | **High** | "Terrain" was fabricated from imagery: `scripts/build-mola-heightmap.mjs` decoded the *colour palette* of a MOLA colour-shade JPG into a greyscale "height" PNG, and `TerrainLab3D` displaced a mesh with it. Visual texture ≠ elevation. | **Fixed** – script, PNG, JPG and component removed; real int16 MOLA DEM windows are used (`api/scientific/dem.py`). Procedural terrain remains only as a labelled educational mode. |
| 2 | **High** | Strategy differences were invented: `api/main.py::plan_route` returned the unchanged great-circle for `conservative`/`science`; `lib/mars.ts::buildRoute` added an arbitrary ±2–3° waypoint offset. No objective function existed. | **Fixed** – four strategies with distinct objectives on a DEM grid (`api/scientific/routing.py`), or explicit "downgraded" with reason. |
| 3 | **High** | Misleading risk language: `survivalProbability` and headlines such as "Misión robusta" derived from hypothetical Gaussian spreads. | **Fixed** – renamed to "fraction of simulated scenarios satisfying modelled constraints", labelled hypothetical, Wilson sampling interval, no headline verdicts. Legacy key kept only as a deprecated alias. |
| 4 | **High** | Two independent Monte Carlo implementations (TS `lib/ares.ts`, Python `analyze_uncertainty`) with different RNGs and hashes → the UI and API could disagree. | **Fixed** – one authoritative engine (`mission.py` + `risk.py`); the TS side mirrors only the closed-form point estimate and is tied to it by golden vectors. |
| 5 | Medium | Radius inconsistency: 3,389.5 km used for routes while the MOLA grid is projected on a 3,396.19 km sphere (0.2 % distance error vs DEM spacing). | **Fixed** – single constant, documented. |
| 6 | Medium | CORS hard-coded to `http://localhost:3000` (`api/main.py`) – a deployment blocker. | **Fixed** – `REDRETURN_CORS_ORIGINS`, GET/POST only, tested. |
| 7 | Medium | No computational-abuse protection; unbounded numeric fields; heavy endpoints open. | **Fixed** – field bounds, list caps, `runs ≤ 20 000`, grid cell cap, body-size cap, per-IP token bucket (in-memory, single instance). |
| 8 | Medium | AI error path returned `f"{type(exc).__name__}: {exc}"` to clients (information leak); default model id `gpt-6-astra` unverifiable. | **Fixed** – generic error, model must be set explicitly server-side, optional layer only paraphrases and never supplies numbers. **Open:** the optional LLM path was not exercised (no key). |
| 9 | Medium | `data/mars.ts` `SOURCES` described Perseverance "live telemetry"; no such integration existed. 463-line Spanish content mixed with app logic. | **Fixed** – replaced by a minimal catalog; no telemetry claims. |
| 10 | Medium | `MarsCommandCenter.tsx` 1,270 lines + 1,924-line CSS; business logic and UI mixed; localStorage reads without guards. | **Fixed** – modular tabs/components, rewritten CSS; storage no longer needed. |
| 11 | Medium | `/api/terrain/elevation` and `/profile` returned HTTP 501 stubs; `/api/datasets/status` hard-coded. | **Fixed** – real endpoints with typed errors. |
| 12 | Low | Python tests never executed in the repo's record; CI used Node 20 while Docker used 22. | **Fixed** – 74 pytest cases run; CI aligned on Node 22 and runs typecheck, Vitest, pytest, golden drift check. |
| 13 | Low | `package.json` `api` script used a Windows-only venv path. | **Fixed**. |
| 14 | Low | `astar` was 4-neighbour Manhattan and unused by the app. | **Mitigated** – kept as `scientific/legacy.py` for the API contract; new 8-neighbour bounded A* is used. |
| 15 | Low | API Dockerfile ran as root, no healthcheck, no DEM data guarantee. | Changed in pass 1 but **unverified**; pass 2 found the image crashed (missing `libexpat1`) — **now fixed and verified** by running it (see #19). |
| 16 | Medium | NASA challenge alignment never established; README only said "NASA Space Apps". | **Fixed** – see `CHALLENGE_ALIGNMENT.md` (official challenge identified). |
| 17 | Low | ~5.8 MB of image assets existed only to drive finding #1. | **Fixed** – removed. |
| 18 | Medium | Real defects found by the new tests during this work: slope reported at a nodata cell; floating-point cell-centre queries labelled "interpolated"; unknown local slope treated as flat in routing; corridor too narrow for detours. | **Fixed** (each has a regression test). |

| 19 | High | Found in the release pass by running things: API container crash (`libexpat`), missing `.dockerignore`, non-canonical Monte Carlo seeding (same request, different result), CORS missing on 429/413 (browser saw network error → silent snapshot fallback), low-contrast text, Vitest collecting Playwright specs, tracked `tsbuildinfo`. | **Fixed**, each with a test or run (`VERIFICATION.md`). |

## Existing features that worked and were preserved
Mars Trek tile globe/2D map concept, great-circle geometry (antimeridian/pole safe), round-trip resource accounting, reserve rules, PDF/JSON/GeoJSON export concept, FastAPI route/mission endpoints (kept, backward compatible), `/api/health`.

## External dependencies
Client-side NASA Mars Trek WMTS tiles (HTTP 200, open CORS verified 2026-11-14); USGS/NASA MOLA GeoTIFF read **once at build time** by `scripts/build_mola_windows.py` (windows are committed). Runtime needs no third-party API and no secrets.

## Still open (not hidden)
- No rock/boulder/soil-strength data: rover-scale obstacle avoidance is absent.
- Only two cached 8°×8° MOLA windows (Jezero, Gale). Other regions return `outside_dem_coverage`.
- (Closed in pass 2) Playwright suite added: 23 tests, `VERIFICATION.md`.
- Rate limiter is in-memory (one process).
- Optional language-model path untested.
