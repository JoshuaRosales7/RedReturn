# Space Apps 2026 compliance check (official pages re-read 2026-11-14)

Sources read in the built-in browser: Participant FAQs, Legal / Participant Terms & Conditions (`/legal/`), Project Submission Guide (`/resources/project-submission-guide/`, dated 2026-11-13), Judging & Awards Guide (`/resources/judging-awards-guide/`), and the challenge page. Global Offers remains login-gated (not read).

## Verified rules and RedReturn status
| Rule (official source) | Status |
|---|---|
| Solution must directly address one official challenge (T&C §Submissions; Judging guide) | **Met**: *Interplanetary Survival Guide: Martian Map*; mapping and partial items in `CHALLENGE_ALIGNMENT.md`. |
| Use ≥ 1 NASA data/resource to be eligible for a Global Award (Submission guide) | **Met**: NASA MGS MOLA elevation (numeric) + NASA Mars Trek layers. |
| Demo: **video ≤ 30 s or ≤ 7 slides** (incl. title); exceeding limits ⇒ not eligible for Global Judging; public link, no login | **Not yet produced.** Draft script and slide outline in `SUBMISSION_PACK.md`. The previous 4-minute `DEMO_SCRIPT.md` is a *live-judging* script, not the submission demo. |
| English for the form and linked materials | Docs/UI are English. |
| "Link to Final Project" must be public, no login | Public repo link possible only after the team publishes (see below). **No live deployment was verified.** |
| "Use of SI" field: SI may accelerate work but **"should not be used to come up with your idea of how to solve the challenge"**; SI-generated **code must be acknowledged in descriptive text and metadata**; generated content may not use NASA branding | Acknowledged in `SI_USE.md`, README and commit trailers. **Team must confirm the solution idea is theirs.** No NASA logos/branding in the repo (checked: none). |
| References: *every* source incl. code/text/images, even open source, must be listed in the References field; NASA may remove awards otherwise (T&C) | `REFERENCES.md` lists data, literature and all direct dependencies with licences. Literature citations flagged "verify before submission". |
| Licensing: original content must be OSI-licensed or freely available; if none is named NASA distributes it under **Apache-2.0**; third-party materials must be public/open and their licences identified (T&C) | **Repo has no LICENSE file.** Team decision needed (Apache-2.0 is the default NASA would apply). Third-party licences are listed in `REFERENCES.md` (MIT/BSD/ISC/Apache-2.0/MPL-2.0 dev-only `@axe-core/playwright`). MOLA DEM: public domain, cite the MOLA team. |
| Originality attestation (checkbox): "submitted project represents my team's original work… all external resources… listed in References… no copyrighted materials without permission" | **Team must decide** whether it can truthfully attest — see the pre-existing-code section. |
| No images/video/audio of persons under 18; no PII | None in the repo. |
| Export control (ITAR/EAR) is the team's responsibility | Only public NASA/USGS data and open-source code. |
| NASA China-funding-restriction review for Global Judging | Team-level eligibility question; not assessable from code. |
| All team members at the same Local Event (≥1 for local; Universal ≥2); ≤ 6 members; submit "Submit for Judging" by 11:59 p.m. 15 Nov (local time) | Team/organiser action; not verifiable here. |

## Pre-existing codebase: what the rules actually say
* **FAQ:** "Teams are not allowed to begin working on the challenges prior to the hackathon." Challenge summaries were released 17 Sep, full statements 28 Oct; the hackathon starts 14 Nov 2026 (submission opens 9:00 a.m. local time).
* **T&C and guides:** no clause explicitly permitting or prohibiting a pre-existing codebase was found (keyword search for pre-existing/prior/existing/previous returned only unrelated text). The originality checkbox and the References rule are the operative statements.
* **Repository facts (from `git log`, authored by identity "Codex" until the last two commits):** first commit 2026-10-13 (*Build Mars Survival mission planning platform*), 12 commits on 2026-11-08, rename to RedReturn 2026-11-14 11:25 −06:00, further work 14:05 −06:00; this transformation 2026-11-14 17:42 and 17:45 −06:00 plus the commits of this release pass.
* **Not established by this analysis:** whether the October/November work was *for this challenge* or a generic project that predates it, and whether organisers accept it. That is the organisers' call.
**Recommendation:** ask the Local Lead / Space Apps contact before submitting; do **not** rewrite history. A factual disclosure for that conversation is in `DISCLOSURE_PREEXISTING_CODE.md`. If organisers say pre-existing code is not allowed, the team should not submit this repository as original work.

## Publication status
`git remote`: `origin = https://github.com/JoshuaRosales7/RedReturn`. The authenticated GitHub account (`Josemedinan`) has **pull-only** permission on it (`push: false`), so the branch could not be pushed. Local-only commits are listed in `RELEASE_READINESS.md`.
