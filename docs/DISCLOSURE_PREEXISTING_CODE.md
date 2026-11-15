# Factual disclosure about a pre-existing codebase (for the team to review with organisers)

> Draft for the team. Edit for accuracy before sending; it states only what the Git history and repository show.

**Project:** RedReturn — https://github.com/JoshuaRosales7/RedReturn · NASA Space Apps 2026 challenge *Interplanetary Survival Guide: Martian Map*.

**Pre-existing work.** The repository contained a Mars mission-planning web application before the hackathon day:

| Date (UTC−06:00) | Commits | Content |
|---|---|---|
| 2026-10-13 | 1 | "Build Mars Survival mission planning platform" (initial version) |
| 2026-11-08 | 12 | ARES copilot, advanced 3D terrain, site updates, public repo URL |
| 2026-11-14 (before 14:05) | 2 | Rename to RedReturn; mission-planning improvements |

All of the above was authored by the Git identity "Codex" (the repository carries an `.openai/hosting.json`), which appears to be an AI coding assistant; the team should state which person(s) directed it and which tool this was.

**Work done during the hackathon (2026-11-14 onward, after those commits):** a new real-data pipeline (NASA MGS MOLA 463 m DEM windows), DEM-based route planner, deterministic mission/risk/emergency engines, API refactor, rebuilt user interface, tests (pytest, Vitest, Playwright), Docker packaging, and documentation. Part of the earlier code (globe rendering concept, geodesy helpers, API skeleton) was reused or rewritten; image-derived pseudo-terrain from the earlier version was removed. `docs/AUDIT_2026.md` lists what was kept and removed.

**Open questions for organisers.**
1. Is a codebase that predates 14 Nov acceptable if disclosed, given the FAQ statement that teams may not begin working on challenges before the hackathon?
2. Was the earlier work started with this challenge in mind? *(Team to answer truthfully; the repository alone does not establish it.)*
3. If acceptable, how should the originality attestation and the References field describe the earlier commits?

**SI use.** Earlier commits: authored via an AI assistant ("Codex"). Hackathon-day work: Claude (Anthropic) via Claude Code. See `docs/SI_USE.md`.

No Git history has been rewritten, squashed or hidden; the full history is intact on branch `feature/mission-decision-intelligence`.
