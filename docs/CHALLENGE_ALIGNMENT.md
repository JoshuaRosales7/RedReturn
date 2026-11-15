# Challenge alignment — NASA Space Apps Challenge 2026

## Chosen challenge (verified on the official site, 2026-11-14)
**Interplanetary Survival Guide: Martian Map** — Intermediate; subjects Human Exploration, Mars, Planets & Moons, Software, Space Exploration.
URL: https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/ (14 challenges are listed at `/2026/challenges/`; this is the Mars/human-exploration/route-mapping one. Related but not chosen: *Space Mission Design Game*, *Identify Earth Locations that Analog … Moon Base and Mars*.)

**What it asks (paraphrased from the Details tab):** create a map, tool or interface a Mars astronaut could use on a surface excursion, using NASA data; layer data from multiple missions (suggested ≥ 3 kinds: optical, thermal, spectral, topographic, geophysical, atmospheric, radiation, chemical); include a route map that avoids significant obstacles; consider astronaut safety, radiation and suit/mobility limits; interactive tools or map generators are acceptable.
**Resources listed (Resources tab):** JPL Mars Trek; USGS-NASA Planetary Geologic Mapping Program; an example Curiosity route map; NASA Worldview; Mars Perseverance Raw Images gallery.

## Requirement → feature map

| Challenge requirement | RedReturn feature | Honest status |
|---|---|---|
| Layered, integrated view from several NASA missions | Mars Explorer layer switcher: MOLA colour shade (topographic, MGS), Viking MDIM 2.1 (optical), THEMIS day/night IR + TES thermal inertia (thermal); numeric MOLA DEM drives all calculations; radiation rate anchored on MSL RAD published dose | Met for *display*; only topography + radiation parameter enter calculations |
| Location/route a crew could plan | Terrain tab: relief map, 3D mesh, profiles, four route strategies with slope cap | Met at 463 m resolution |
| Avoid significant obstacles | Hard slope cap on step and Horn slope, nodata impassable, obstruction mask in Emergency | **Partial** – kilometre-scale terrain only; no boulder/rock map (class E in `DATA_PROVENANCE.md`) |
| Safety, radiation, mobility | Dose limit, reserve/contingency rules, slope-derated speed, climb energy, Monte Carlo what-ifs, failure simulator | Scenario assumptions; never certified |
| Hyperlocal (spacewalk-scale) rather than global | Local ≈ 25–30 km corridors on a 463 m DEM | **Partial** – not HiRISE/CTX scale; stated in the UI |
| Scientific objectives | Science stops with dwell time; science-prioritised strategy (disabled without declared stops) | Met; no automatic science-value layer exists |
| Usable interface (HUD/tablet/habitat) | Mission-operations web UI, responsive to 375 px, keyboard shortcuts 1–8 | Met for planning use; not a suit HUD |

## Unresolved / disclosed items (updated after the release pass; details in `COMPLIANCE.md`)
1. **Pre-existing code.** The FAQ says teams may not begin working on challenges before the hackathon; this repository's first commit is 2026-10-13. The T&C do not address pre-existing code; the originality checkbox applies. **Unresolved — ask the organisers** (`DISCLOSURE_PREEXISTING_CODE.md`). Git history is intact.
2. **SI disclosure** is mandatory and the idea must be the team's own (`SI_USE.md`).
3. **Submission rules now verified:** demo ≤ 30 s video or ≤ 7 slides (not yet produced), public links, References field, official judging criteria Impact/Creativity/Validity/Relevance/Presentation (`SUBMISSION_PACK.md`).
4. **Global Offers** page still login-gated — not read (`GLOBAL_OFFERS.md`).

## Constraint the product obeys
No claim of NASA validation or endorsement; the challenge page notes NASA does not endorse non-U.S.-Government entities.
