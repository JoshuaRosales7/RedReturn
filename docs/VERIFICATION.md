# Verification record

Only checks **actually executed** are listed. Date 2026-11-14/15. macOS (Darwin 25.5), Node 25.9.0 / npm 11.12.1, Python 3.12.11 (venv), Docker 29.9.3, Chrome (system) via Playwright 1.65.1, Next.js 15.5.27, Vitest 3.2.7, pytest 9.2.0.
Final raw outputs are summarised here; reproduce with the commands.

## Automated suites (final state; all passed)
| Command | Result |
|---|---|
| `npm ci` | PASS (220 packages) |
| `npm run typecheck` | PASS (exit 0) |
| `npm test` | PASS — 23/23 Vitest, 1 file (config scopes to `tests/`; Playwright specs excluded) |
| `npm run build` | PASS — compiled, types valid, static export 4/4 |
| `.venv/bin/python -m pytest api -q` | PASS — **76** passed |
| clean-venv install from `api/requirements.txt` + pytest (earlier in pass; 74 tests then) | PASS |
| `ruff check api scripts --select F,E9` | PASS |
| `scripts/gen_golden.py` + `git diff --exit-code tests/golden` | PASS — no drift |
| `scripts/validate_independent.py` | PASS — **16/16** (see `VALIDATION_RESULTS.md`) |
| `npx playwright test` against the Docker stack | PASS — **23/23**, three consecutive full runs after the fixes below (≈1.7 min each) |

## Docker (executed)
`docker compose build` → web 80.2 MB, API 576 MB. `docker compose up -d`: API `healthy` (HEALTHCHECK), runs as uid 10001, `/api/datasets/status` → `mounted`, both DEM checksums OK. In the container: alternatives (18.1° / 6.9° / 8.4° / 10.0°), emergency (−19.7 % → +13.5 %, `abort_to_base`) and the Monte Carlo hash **identical to the local venv run and to the committed snapshot** (cross-environment determinism). CORS preflight from `http://localhost:3000` → 200 with matching `Access-Control-Allow-Origin`.

## Playwright coverage (`e2e/`)
Journeys: (1) dashboard; (2) real NASA terrain (canvas, profile, API raw value −2644.464 m, typed 404 outside coverage); (3) route comparison (4 rows, shortest violates slope, 18.1°/6.9° asserted); (4) risk analysis (label, sampling-error text, histogram, hash, live value equals committed snapshot); (5–6) battery failure → revised decision (−19.7 % / +13.5 %, "abort"); (6b) impossible case → "No option satisfies the model" + required extra energy; (7) PDF/JSON/GeoJSON downloads parsed and validated; ARES provenance; (8) API-blocked fallback: labelled snapshot on every tab, offline export named `-offline`, non-demo input → explicit "API offline", no fabricated table.
Quality: axe-core WCAG 2.0/2.1 A+AA on all 8 tabs (no serious/critical), keyboard shortcut + focus, reduced-motion CSS, no horizontal overflow on all 8 tabs at **375, 768 and 1280 px**, touch target ≥ 44 px on mobile nav.

## Defects found and fixed in this pass (each by a failing test or run)
1. `api/Dockerfile`: container crashed — `libexpat.so.1` missing for rasterio on `python:slim` → apt `libexpat1` added. (Docker run, not reproducible without Docker.)
2. No `.dockerignore`: host `node_modules`/`.venv` would be copied into the image → added.
3. **Reproducibility bug**: Python default `18` vs sent `18.0` produced different Monte Carlo seeds (UI 74.7 % vs snapshot 75.0 %) → canonical hashing (numbers as floats, display names ignored) + regression test; snapshot regenerated (75.1 %).
4. Stale snapshot baked into the web image was caught by the Playwright live-vs-snapshot check → image rebuilt.
5. **Rate-limit/413 responses had no CORS headers** (middleware order), so the browser saw a network error and silently fell back to the snapshot → CORS now outermost; limits raised to 600/min (180/min heavy); regression test.
6. Colour contrast failures (`--dim` 4.06–4.43:1) → palette lightened; axe now clean.
7. Vitest was collecting Playwright specs → `vitest.config.ts`.
8. `tsconfig.tsbuildinfo` was tracked → untracked and ignored.
9. Intermittent failures before fix 5: a 12 px overflow at 375 px (diagnostics showed the extra "Precomputed snapshot" chip, i.e. a rate-limited API call fell back to the snapshot — confirmed cause) and, in another run, the reduced-motion test could not find the *Recommended* stat (consistent with the same cause; **not directly confirmed**). Neither recurred in 3/3 full runs after the fix.

## NOT executed / unverified
Hosted deployment (no credentials; none attempted) · pushing the branch (no write permission to `JoshuaRosales7/RedReturn`) · GitHub Actions run (workflow edited, **never executed**; includes a new `e2e` job) · `render.yaml` · real-device/Safari/Firefox testing · screen-reader testing · Lighthouse · `npm audit` · optional language-model path · physical validation of the resource model · Global Offers page contents.

## UI redesign pass (dashboard layout, terrain map fix, guided tour)

- Playwright against the **rebuilt Docker stack** (web :3000, API :8000): **26/26 pass** (the 25 below plus a tablet-width 3D regression test added afterwards, run alone against the same stack). An earlier 25/25 run was against `next dev`.
- Defect found by hand after the first push: with a short route the 3D mesh rendered blank at ~800 px width (the WebGL canvas sat in a container with no explicit height). Fixed with a fixed-height stage; verified by eye at 800 px and 1440 px. The new regression test was not run against the pre-fix code, so it is not proven to fail without the fix.
- The earlier tests missed this because they only used the default 25 km demo route at 1280 px.
- `tsc --noEmit` clean, `npm test` 23/23, `npm run build` succeeds. Backend untouched.
- Visual review by eye: Overview, Terrain (relief and 3D), Planner on desktop; Overview on mobile. Other tabs are covered by axe and no-overflow tests only.
