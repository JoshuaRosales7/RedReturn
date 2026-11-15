# References (for the Space Apps "References" field)

Status key: **fetched** = confirmed during this work; **recalled** = cited from memory, *verify DOI/pages before submission*.

## NASA / USGS data and resources
1. NASA MGS MOLA team; USGS Astrogeology. *Mars MGS MOLA DEM 463 m (MEGDR-derived global mosaic).* https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m — file `Mars_MGS_MOLA_DEM_mosaic_global_463m.tif`, ETag `cccf7001294ee9f503b13318eab83086-254`. Public domain; cite MOLA team. (**fetched**: metadata read via HTTP range requests)
2. NASA JPL Mars Trek WMTS layers (display only): `Mars_MGS_MOLA_ClrShade_merge_global_463m`, `Mars_Viking_MDIM21_ClrMosaic_global_232m`, `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`, `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018`, `TES_Thermal_Inertia`. https://trek.nasa.gov/mars/ (**fetched**: tile HTTP 200, 2026-11-14). Instrument papers for THEMIS/TES/Viking MDIM: *team to add after checking the Trek layer metadata.*
3. Challenge page and Resources: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/ (**fetched**).
4. USGS Planetary Gazetteer (named-feature reference for the catalog; coordinates approximate): https://planetarynames.wr.usgs.gov/ (**not integrated; reference only**).

## Literature
5. Smith, D. E., et al. (2001). Mars Orbiter Laser Altimeter: Experiment summary after the first year of global mapping of Mars. *J. Geophys. Res.* 106(E10), 23689–23722. doi:10.1029/2000JE001364 (**recalled**)
6. Hassler, D. M., et al. (2014). Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover. *Science* 343(6169), 1244797. doi:10.1126/science.1244797 (**recalled**; source of the ≈0.64 mSv/day figure behind the 0.025 mSv/h default)
7. Horn, B. K. P. (1981). Hill shading and the reflectance map. *Proc. IEEE* 69(1), 14–47. (**recalled**; slope algorithm)
8. Wilson, E. B. (1927). Probable inference, the law of succession, and statistical inference. *J. Am. Stat. Assoc.* 22(158), 209–212. (**recalled**; Wilson interval)
9. Harris, C. R., et al. (2020). Array programming with NumPy. *Nature* 585, 357–362. (**recalled**)

## Software (all used directly; licences from installed package metadata, 2026-11-14)
FastAPI 0.163.0 (MIT) · Uvicorn 0.54.0 (BSD-3) · Pydantic 2.14.3 (MIT) · NumPy 2.5.4 (BSD-3 and others) · rasterio 1.5.2 (BSD-3; bundles GDAL, MIT/X) · httpx 0.28.1 (BSD-3) · pytest 9.2.0 (MIT) · ruff (MIT) · Next.js 15.5.27 (MIT) · React 19.3.0 (MIT) · three.js 0.180.0 (MIT) · @react-three/fiber 9.8.1 (MIT) · @react-three/drei 10.7.9 (MIT) · Recharts 3.10.1 (MIT) · Zustand 5.0.15 (MIT) · jsPDF 3.0.4 (MIT) · lucide-react 0.545.0 (ISC) · Tailwind CSS 4.3.3 (MIT) · TypeScript 5.9.3 (Apache-2.0) · Vitest 3.2.7 (MIT) · Playwright 1.65.1 (Apache-2.0) · @axe-core/playwright 4.14.0 (**MPL-2.0**, dev-only) · Docker/nginx/Python/Node base images (their own licences).

## Text and images
All UI text, documentation and the banner SVGs in `docs/assets` were written/generated within this repository (AI-assisted; see `SI_USE.md`). No third-party images, audio or video are bundled; the NASA tiles are fetched live from Mars Trek.
