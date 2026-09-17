# Roadmap — GeoRakshak

> Durations are left relative because the SIH 2026 schedule dates are not recorded here. The Product/Communication Lead maps phases onto the official SIH calendar once it is confirmed.
> Rule: **don't start a phase until the previous phase's acceptance criteria pass**, except where a dependency is explicitly marked as parallel.

Owner abbreviations: FE = Frontend, BE = Backend, ML = AI/ML, MOB = Mobile, VID = Video, PC = Product/Communication. See [team.md](team.md).

---

## Phase 0 — Research & Architecture

**Goal:** Remove the biggest unknowns and get human approval on the key decisions before writing code.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 0.1 | Paste the verbatim SIH26001 description and re-map requirements | PC |
| 0.2 | Decide on stack (H1–H3) and hosting (H6) | BE (lead), FE, MOB, ML |
| 0.3 | Choose the pilot geography (H4) using data availability | ML (lead), PC |
| 0.4 | Verification spike for each MVP data source: access, coverage, licence | ML (lead), PC (licence records) |
| 0.5 | Confirm basemap tile source terms (H5) | FE |
| 0.6 | Confirm initial languages (H9) and find native-speaker reviewers | PC |
| 0.7 | Low-fidelity wireframes: dashboard, location detail, alert approval, mobile report | FE, MOB, PC |
| 0.8 | Draft the demo storyboard | PC, VID |

**Dependencies:** none.

**Deliverables:** updated `problem-statement.md`, a decisions table in `architecture.md` marked APPROVED, data sources marked VERIFIED/REJECTED, wireframes, and a storyboard draft.

**Acceptance criteria**
- The official problem statement text is in the repo.
- H1–H6 and H9 are approved and recorded.
- At least one VERIFIED source for rainfall, DEM, landslide inventory, roads, villages and boundaries for the pilot area.
- No unresolved blocker on licences for demo use.

---

## Phase 1 — Foundation

**Goal:** A runnable, tested skeleton of every component, with CI.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 1.1 | Repo structure, `.env.example`, `.gitignore`, contribution guide | BE |
| 1.2 | CI pipeline: lint, format, tests per component | BE |
| 1.3 | Local dev environment with PostgreSQL + PostGIS | BE |
| 1.4 | Initial migrations: users, organizations, admin_boundaries, data_sources, risk_zones | BE |
| 1.5 | Auth + RBAC + `/health` | BE |
| 1.6 | Web app shell: login, layout, empty map with approved basemap | FE |
| 1.7 | Mobile app shell: login, navigation, language switch scaffold | MOB |
| 1.8 | ML service shell: `/health`, `/model`, `/predict` stub returning a fixed contract | ML |
| 1.9 | Pilot-area grid generation script and boundary load | ML (grid), BE (load into DB) |
| 1.10 | Dataset registry records for verified sources | ML, PC |

**Dependencies:** Phase 0 decisions.

**Deliverables:** skeleton apps/services, CI green, DB migrations, pilot grid in DB.

**Acceptance criteria**
- A fresh clone plus documented commands starts all services locally.
- CI runs on every PR and passes.
- A user can log in on web and mobile against the local backend.
- The pilot grid and district boundary render on the web map.

---

## Phase 2 — First Vertical Slice

**Goal:** One thin, end-to-end path: risk shown on the map → field report with photo → shown on the dashboard.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 2.1 | Static terrain features (slope, elevation, relief) computed for pilot cells | ML |
| 2.2 | Rule-based baseline B0 in the ML service, with explanations | ML |
| 2.3 | Batch job: score all cells → `risk_assessments` + `risk_factors` | ML (job logic), BE (persistence API/tables) |
| 2.4 | `GET /risk-zones` (GeoJSON) and `GET /risk-zones/{id}` | BE |
| 2.5 | Web risk map with class colours, provenance badge and detail panel with factors | FE |
| 2.6 | `POST /field-reports` + evidence upload (online only) | BE |
| 2.7 | Mobile report form with GPS + photo (online) | MOB |
| 2.8 | Dashboard list/map of incoming reports | FE |
| 2.9 | Load historical landslides and villages/roads layers | ML (prep), BE (load/endpoints) |

**Dependencies:** Phase 1.

**Deliverables:** a working slice on real terrain data and the baseline model.

**Acceptance criteria**
- Every pilot cell has a B0 score with ≥3 explanation factors.
- The web map shows risk classes and details with correct provenance labels.
- A mobile report with a photo appears on the dashboard within one refresh.
- Endpoint tests cover the success and validation failure paths.

---

## Phase 3 — Risk Engine

**Goal:** Evidence-based risk scoring with honest validation.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 3.1 | Rainfall ingestion job (historical + latest) aggregated to cells | ML (pipeline), BE (scheduling/ingestion-run records) |
| 3.2 | Feature table builder, versioned | ML |
| 3.3 | Label construction from the inventory with documented sampling | ML |
| 3.4 | Train B1 logistic regression + a tree model, with spatial CV | ML |
| 3.5 | Evaluation report + model card | ML |
| 3.6 | Threshold selection and team review (H11) | ML (proposal), PC (review meeting) |
| 3.7 | Model registry + active-model switch | ML (service), BE (`model_versions` table) |
| 3.8 | Risk history endpoint + trend view on dashboard | BE, FE |
| 3.9 | Data freshness indicators | BE (API), FE (UI) |

**Dependencies:** Phase 2, and verified inventory + rainfall data.

**Deliverables:** an active model version with a model card, and automated rainfall-driven score updates.

**Acceptance criteria**
- Spatial-CV metrics (PR-AUC, ROC-AUC, recall at threshold, % area flagged) are documented.
- The adopted model beats B1 under the same validation, or B1/B0 stays active with the reason documented.
- Scores refresh automatically after ingestion. Stale data is flagged in the UI.
- No reported metric uses simulated data.

---

## Phase 4 — Alerts & Response

**Goal:** Human-approved alerts reach field officers, and verified evidence drives response priority.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 4.1 | Alert rules: threshold crossing → `DRAFT`, with deduplication | BE |
| 4.2 | Alert approval UI (edit, recipients, languages) | FE |
| 4.3 | Alert endpoints + state machine + audit log | BE |
| 4.4 | Mobile alert inbox + acknowledge | MOB |
| 4.5 | Report verification UI + endpoint | FE, BE |
| 4.6 | Incident grouping (reports → incident by distance/time) | BE |
| 4.7 | Response-priority rules engine with reasons | BE |
| 4.8 | Priority panel on dashboard | FE |

**Dependencies:** Phase 3 (or B0 if Phase 3 is delayed).

**Deliverables:** a complete alert → verification → priority loop.

**Acceptance criteria**
- An alert cannot be published without approval, enforced in the API and covered by tests.
- A field officer receives, opens and acknowledges an alert on mobile.
- Verifying a report updates the priority list, with reasons shown.
- Every approval and verification is written to the audit log.

---

## Phase 5 — Offline & Multilingual

**Goal:** Field reporting works without connectivity, and warnings display in the approved languages.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 5.1 | Local report queue with `client_report_id` | MOB |
| 5.2 | Background sync with retry/backoff, metadata-then-media | MOB |
| 5.3 | Idempotent `POST /field-reports` + `POST /field-reports/sync` | BE |
| 5.4 | Sync status UI (Queued / Syncing / Synced / Failed) | MOB |
| 5.5 | Alert templates per language, reviewed by native speakers | PC (content + review), BE (template storage/rendering) |
| 5.6 | Web and mobile UI string localisation | FE (web), MOB (mobile) |
| 5.7 | Offline and duplicate-sync test suite | MOB, BE |

**Dependencies:** Phase 4 (alerts), Phase 2 (reports).

**Deliverables:** an offline-capable mobile app and multilingual alerts.

**Acceptance criteria**
- A report created in airplane mode survives an app restart and syncs exactly once when back online.
- Partial media upload failures retry without duplicating the report.
- An alert renders in every approved language from reviewed templates.
- No safety-critical warning text is machine-translated without human review.

---

## Phase 6 — Advanced Intelligence

**Goal:** Improve accuracy and situational awareness **only where the MVP is stable** and data justifies it.

**Candidate tasks (prioritise after the Phase 5 review)**
| # | Task | Owner |
|---|---|---|
| 6.1 | Stage B dynamic model (if enough dated events exist) | ML |
| 6.2 | Sentinel-2 based post-event change detection prototype | ML |
| 6.3 | Sentinel-1 SAR/InSAR feasibility study | ML |
| 6.4 | Forecast rainfall features (lead-time risk) | ML |
| 6.5 | Road impact view (at-risk road segments) | BE, FE |
| 6.6 | Comparison with the GSI susceptibility map / external model | ML |
| 6.7 | Offline map tiles for the pilot area | MOB |

**Dependencies:** Phases 3–5 accepted.

**Deliverables:** evaluated improvements, each with a go/no-go note.

**Acceptance criteria**
- Each adopted enhancement shows a documented improvement under the Phase 3 validation protocol, or a clear user value for non-ML features.
- Nothing in this phase regresses the MVP demo flow (smoke test passes).

---

## Phase 7 — Demo & Production Hardening

**Goal:** A reliable, honest, compelling jury demo, and a system that doesn't fall over.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 7.1 | Demo scenario data (`SIMULATED_DEMO`) + reset script | BE (reset), ML (scenario rainfall) |
| 7.2 | End-to-end smoke test of the demo flow | BE (lead), FE, MOB |
| 7.3 | Deploy demo environment (approved hosting) | BE |
| 7.4 | Security pass: auth, RBAC, upload validation, secrets | BE |
| 7.5 | Performance check: map load on pilot area, report sync | FE, BE |
| 7.6 | UI polish, accessibility basics, disclaimer text | FE, MOB |
| 7.7 | Demo script, pitch narrative, Q&A sheet (limitations, data honesty) | PC |
| 7.8 | Backup demo video + screen recordings | VID |
| 7.9 | Rehearsals (≥3 full timed runs) | PC (lead), all |

**Dependencies:** Phases 1–5 (Phase 6 optional).

**Deliverables:** deployed demo, reset script, backup video, pitch deck, Q&A sheet.

**Acceptance criteria**
- The full demo runs in ≤ 3:00 in three consecutive rehearsals.
- The demo can be reset to its initial state in under 1 minute.
- The backup video covers the full story in case the live demo fails.
- Every simulated element is visibly labelled on screen.
- No known critical/high security issue remains open.
