# Super-Intelligence (SI/AI) tool use — acknowledgement

Required by the Space Apps submission guide: SI-generated **code and data must be acknowledged in descriptive text and metadata**.

| Part | SI tool | How used |
|---|---|---|
| Earlier iterations of the repository (commits 2026-10-13 … 2026-11-14 14:05, author "Codex") | AI coding assistant ("Codex"; confirm product/model with the team) | Generated and edited application code and content. |
| Hackathon-day transformation and release pass (commits co-authored `Claude Sonnet 5.5`) | Claude (Anthropic) via Claude Code | Repository audit, DEM pipeline, routing, risk/emergency engines, API refactor, UI rebuild, tests (pytest/Vitest/Playwright), Docker, documentation, official-rules reading. A team member directed the work and ran/reviewed outputs. |
| Runtime | none by default | An optional language-model paraphrase layer exists (server-side, needs `OPENAI_API_KEY` + `OPENAI_MODEL`); it is off in the demo and never supplies numbers. All results are deterministic code. |

Metadata: commit trailers `Co-Authored-By: Claude Sonnet 5.5`; this file; README section "SI-assisted development".
**Not SI-generated:** the NASA/USGS datasets (MOLA DEM, Trek tiles) and the cited literature.
**Team responsibility:** the official guide says SI "should not be used to come up with your idea of how to solve the challenge". The team must confirm the concept (decision-support for a Mars excursion: real terrain → hazard → resources → failure → revised return) is its own.
