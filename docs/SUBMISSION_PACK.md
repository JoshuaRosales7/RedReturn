# Space Apps submission pack (draft for the team — fields mirror the official Project Submission form)

**Hard limits (official):** demo = *video ≤ 30 s* **or** *≤ 7 slides incl. title/intro*; public link, no login; English (video may be another language with English subtitles); no under-18 likeness; all form fields required; submit before 11:59 p.m. 15 Nov (local time of the Local Event).

## Project Name
RedReturn — Mars mission decision intelligence

## High-Level Project Summary
RedReturn helps plan a Mars surface excursion with real NASA terrain: it compares routes on MGS MOLA elevation data, shows which assumptions drive the risk, simulates a failure mid-traverse and recommends whether to abort and return — while stating clearly what the data cannot see. For *Interplanetary Survival Guide: Martian Map* it layers topographic, optical and thermal NASA data with a radiation-aware resource model so a crew can see where a route is hazardous, what it costs in oxygen, energy and time, and what changes when things go wrong.

## Link to Project Demo
*[Team to add: public YouTube/Drive/GitHub link — 30-second video or 7-slide deck. Not produced by this work.]*

## Link to Final Project
*[Team to add after publishing: public repository URL and, if deployed, the public web URL. Nothing was deployed or pushed by this work.]*

## Detailed Project Description
**What it does.** Real MOLA elevation (463 m grid, Jezero and Gale windows) → four route strategies with explicit slope/no-data rules → resource and time accounting (oxygen, energy, water, dose, reserves) → seeded Monte Carlo that is labelled hypothetical, with sensitivity and failure modes → emergency simulator (battery, speed, oxygen, water, delay, comms, obstruction) that compares *original / failure / revised* missions → ARES assistant that answers only from those calculations → PDF/JSON/GeoJSON exports with reproducibility hashes.
**Demo result.** In a Jezero-crater-rim scenario the straight line crosses an 18.1° slope (scenario limit 15°); a resource-conservative detour (+2.5 km, 640 m vs 871 m of climbing) stays under 8.4°. A simulated 35 % battery loss plus 30 % speed loss at 60 % of the outbound leg breaks the plan (−19.7 % margin) and the model recommends aborting to base (+13.5 %).
**How it works.** Python/FastAPI + NumPy + rasterio on a committed NASA DEM window; one deterministic mission core shared by the point estimate, Monte Carlo and emergency engine; Next.js/React/Three.js front end; golden-vector tests tie Python and TypeScript together; 76 pytest, 23 Vitest, 23 Playwright (incl. axe accessibility, 375/768/1280 px) tests; Docker images.
**Honest limits.** 463 m resolution (no rocks), two cached regions, scenario-based rates, never certifies a route.
**Tools/languages.** Python 3.12, TypeScript, FastAPI, NumPy, rasterio, Next.js, React, Three.js, Recharts, Docker, Playwright.

## Use of Super Intelligence (SI)  *(data-collection field; not shown to judges)*
See `SI_USE.md`: earlier iterations authored by an AI coding assistant ("Codex" identity in Git); the hackathon-day transformation and release pass by Claude (Anthropic) via Claude Code, directed and reviewed by a team member. All numbers come from deterministic code. **Team must confirm the idea of the solution is theirs.**

## NASA Data
NASA MGS MOLA elevation (MEGDR-derived 463 m DEM; windows around Jezero and Gale) — core of all route/slope/resource calculations. NASA JPL Mars Trek imagery layers (MOLA colour shade, Viking MDIM 2.1, THEMIS day/night IR, TES thermal inertia) for context. Published MSL RAD surface-dose figure as a radiation-rate assumption.

## Space Agency Partner Data and Other References
Paste from `REFERENCES.md`.

---
## 30-second video script (if the team chooses video)
`[0:00]` "I'm <name>, team <team>." `[0:03]` "Challenge: Interplanetary Survival Guide — a Martian map for a human crew." `[0:07]` "RedReturn: *plan it, break it, get home.*" `[0:10]` *Screen: terrain relief with the shortest line crossing a red 18° slope, detour in amber.* "Real NASA MOLA elevation shows the shortest route hits an 18-degree ridge." `[0:18]` *Screen: emergency table, FAILURE −19.7 %, REVISED +13.5 %.* "Simulate a battery failure and RedReturn explains whether to push on or abort — with its limits stated." `[0:26]` "Next: HiRISE-scale hazards for the first Marswalk." *(≤ 30 s; read at normal pace, ~70 words.)*

## 7-slide outline (if the team chooses slides; title and intro count toward 7)
1. **Title + team + names + challenge** (*Interplanetary Survival Guide: Martian Map*) — screenshot of the Terrain tab.
2. **The problem**: layered data exists, but not as a route-and-resources decision for one excursion.
3. **Solution overview**: real MOLA DEM → routes → resources → uncertainty → failure → revised return (flow diagram).
4. **Real NASA data in action**: relief + profile; shortest 18.1° vs detour 6.9°/8.4°; data classes A–E.
5. **Failure simulation**: ORIGINAL vs FAILURE vs REVISED table (−19.7 % → +13.5 %).
6. **Trust & validity**: independent recomputation 16/16, 76+23+23 tests, hypothetical-not-probability labelling, what it cannot see.
7. **Impact & next steps**: HiRISE/CTX hazards, more regions, suit/EVA models; team names and references.
