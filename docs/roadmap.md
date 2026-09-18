# Roadmap — GeoRakshak

> **Revision:** aligned with the official SIH26001 requirements OR-01 to OR-21 ([product-spec.md §2](product-spec.md)). Each phase lists the requirements it delivers.
> Durations are relative. The Product/Communication Lead maps phases onto the confirmed SIH 2026 calendar.
> Rule: **don't start a phase until the previous phase's acceptance criteria pass**, except for the parallel tracks marked below.

Owner abbreviations: FE = Frontend, BE = Backend, ML = AI/ML, MOB = Mobile, VID = Video, PC = Product/Communication. See [team.md](team.md).

## Parallel tracks

| Track | Runs through | Why |
|---|---|---|
| **ML data and model** | Phases 0 → 3 continuously | The longest and least predictable work. Hands over the grid and B0 in Phase 2, and the trained model in Phase 3. |
| **External access requests** (IMD API, SMS gateway compliance, push provider, cloud account) | Start in Phase 0 | Lead times are outside our control |
| **FE / MOB against mocks** | Phase 1 onward | Not blocked by the backend |
| **VID footage** | Phase 2 onward | Record each working slice as it lands |

---

## Phase 0 — Research & Architecture

**Goal:** Remove the biggest unknowns, start slow external requests, and get approvals.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 0.1 | ✅ Official requirement list recorded in problem-statement.md (OR-01 to OR-21). Remaining: add portal metadata (organisation, category, theme) if available. | PC |
| 0.2 | Record concrete choices under the approved rules: web framework + map library (H2, FE), mobile framework (H3, MOB), cloud provider + bucket (H6/H7, BE), basemap after terms check (H5, FE). *(Python + FastAPI, imported ML package, FCM, sandbox SMS and the tier policy are already approved.)* | FE, MOB, BE |
| 0.3 | Data spike: DEM, landslide inventory, OSM (roads, villages, facilities), IMD gridded rainfall, Sentinel-2 / WorldCover for 2–3 candidate areas. Record inventory counts. | ML |
| 0.4 | Select the pilot area using the approved criterion (H4: inventory count + data coverage) and record it | ML (lead), PC |
| 0.5 | **Submit the IMD API access request.** Record the date and reference. | PC |
| 0.6 | IMERG feasibility check (Earthdata account, file format, latency) | ML |
| 0.7 | SMS gateway feasibility (H14): check DLT compliance, cost and test-number consent. Document it. Gateway mode stays off until that's cleared. *(Sandbox default approved.)* | PC (lead), BE |
| 0.8 | Set up the FCM project (H8). Terms check and recording of the non-IMD forecast provider used if IMD access isn't granted (H16). *(No physical sensor node, H17.)* | BE, MOB (FCM), ML + BE (H16) |
| 0.9 | Record the pilot-area notification language (H9: English + Hindi + one pilot-area language). Find native-speaker reviewers. | PC |
| 0.10 | Wireframes: dashboard (incl. data-source status panel, forecast toggle, road layer), cell detail, alert approval, dispatch log; mobile field and citizen modes | FE, MOB, PC |
| 0.11 | Demo storyboard | PC, VID |

**Dependencies:** none.

**Deliverables:** approved decisions, data spike report, pilot area, access requests submitted, wireframes, storyboard.

**Acceptance criteria**
- The official requirement list is in the repo, and the compliance matrix matches it (done 2026-09-17).
- Concrete choices for H2–H6 and H16 are recorded in [architecture.md §9](architecture.md). H10 (final data sources per layer) is approved after verification.
- Verified sources for DEM, inventory, OSM, IMD gridded rainfall and one satellite-derived layer for the pilot area.
- The IMD API request has been submitted, with evidence recorded.

---

## Phase 1 — Foundation

**Goal:** A runnable, tested skeleton, deployed to the cloud early, with frozen contracts and adapter interfaces.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 1.1 | Repo layout, `.env.example`, `.gitignore`, container setup (PostGIS + backend + web) | BE |
| 1.2 | CI: lint, format and tests per component | BE |
| 1.3 | **Deploy the skeleton to the approved cloud** (HTTPS, database, bucket) | BE |
| 1.4 | Generate mock JSON for every endpoint in the **frozen** API contract v1 ([api.md](api.md)). Contract changes go through a PR that also updates database.md. | BE (FE, MOB, ML review) |
| 1.5 | Implement schema v1 migrations from the approved database.md MVP tables + seed (5 roles, demo users, `data_sources` with honest initial statuses) | BE |
| 1.6 | Auth + RBAC (`ADMIN`, `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `FIELD_OFFICER`, `CITIZEN`) | BE |
| 1.7 | Adapter interfaces + data-source status registry: `WeatherProvider`, `SensorSource`, `SatelliteSource`, `NotificationChannel` | BE (interfaces), ML (weather/satellite semantics) |
| 1.8 | Web shell: login, map, data-source status panel, mode banner, from mocks | FE |
| 1.9 | Mobile shell: login, field/citizen mode switch, **local-first storage**, inbox, from mocks | MOB |
| 1.10 | Pilot grid + boundary load | ML (grid), BE (load) |

**Dependencies:** Phase 0 approvals.

**Deliverables:** skeleton on cloud, CI green, contracts frozen, interfaces defined.

**Acceptance criteria**
- A fresh clone runs locally with one documented command. The same build is reachable on the cloud URL.
- Web and mobile log in against the cloud backend, and render mock data for every MVP screen.
- The status panel lists every adapter and channel with its honest initial status.

**Delivers (partial):** OR-21.

---

## Phase 2 — First Vertical Slice

**Goal:** A risk map on real static data, with exposure and a real geo-tagged photo/video report reaching the dashboard.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 2.1 | Terrain features (slope, relief, curvature) per cell | ML |
| 2.2 | Satellite-derived features and layers: WorldCover, Sentinel-2 vegetation composite, imagery layer with date range | ML |
| 2.3 | Historical landslide layer | ML (prep), BE (load/API) |
| 2.4 | Exposure: villages, facilities and road segments from OSM, with segment splitting | ML (prep), BE (load/API) |
| 2.5 | `georakshak_ml` package with B0 `score()` (factors included) / `active_model()` + tests | ML |
| 2.6 | Batch scoring → assessments + factors. Risk layer and cell detail endpoints. | BE |
| 2.7 | Web: risk map with severity levels, layers (landslides, villages, facilities, roads, satellite), cell detail with factors and provenance | FE |
| 2.8 | Reports API (duplicate-safe) + media upload (photo, video ≤30 s) to object storage | BE |
| 2.9 | Mobile report form: GPS, photo, short video, category (incl. `ROAD_BLOCKED`), stored locally then submitted online | MOB |
| 2.10 | Web: reports layer with photo/video viewer | FE |

**Dependencies:** Phase 1.

**Acceptance criteria**
- Every pilot cell has a B0 score, a severity level and ≥3 factors, including at least one satellite-derived factor.
- Villages, facilities and roads render, with exposure counts per cell.
- A mobile report with a photo and a video appears on the dashboard, with media playable.
- Endpoint and scoring tests pass.

**Delivers:** OR-03, OR-04, OR-05, OR-08, OR-09, OR-10, OR-11 (B0 level).

---

## Phase 3 — Risk Engine

**Goal:** Real AI, monitoring cycles, sensors, forecasts and road status.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 3.1 | IMD gridded rainfall ingestion → cells, antecedent and anomaly features | ML (pipeline), BE (scheduler, status registry) |
| 3.2 | Label construction, trained Stage A model, spatial CV, evaluation report, model card | ML |
| 3.3 | Replace B0 with the trained model + Stage B trigger behind the same `score()` interface | ML |
| 3.4 | Scheduler monitoring cycle: ingest → score current + forecast → road status → (alert hook) | BE |
| 3.5 | Replay mode (real historical period preferred) + mode banner | ML (scenario data), BE (replay job), FE (banner) |
| 3.6 | Forecast adapter (approved provider or replay) + forecast risk +24/48/72 h + web forecast toggle | ML (forecast features), BE (adapter/storage), FE (toggle) |
| 3.7 | Sensor ingestion API + virtual station emulator + soil moisture modifier + sensor map layer | BE (API), ML (emulator + modifier), FE (layer) |
| 3.8 | Road-segment status (`AT_RISK`) + village "access at risk" rule + web road status layer | BE, FE |
| 3.9 | IMD API adapter slot (`AWAITING_ACCESS`) and IMERG feed slot (`NOT_CONNECTED`, or connected if 0.6 succeeded) | BE (slots), ML (IMERG if feasible) |
| 3.10 | Threshold proposal for severity levels, and team review (H11) | ML, PC |

**Dependencies:** Phase 2. Verified inventory and rainfall.

**Acceptance criteria**
- The trained model beats or matches the logistic regression baseline under spatial CV. Model card published. No metric uses simulated data.
- A replay step visibly changes risk, forecast risk and road status on the dashboard, with correct provenance.
- Virtual sensor readings arrive through the real ingestion API and appear as a labelled explanation factor.
- The status panel correctly shows `CONNECTED_HISTORICAL`, `SIMULATED`, `AWAITING_ACCESS` and `NOT_CONNECTED` where applicable.

**Delivers:** OR-01, OR-02, OR-06, OR-11, OR-12, OR-13. OR-17, OR-18 and OR-19 at integration-ready level.

---

## Phase 4 — Alerts & Response

**Goal:** Automated tiered warnings over app and SMS channels, verification and prioritisation.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 4.1 | Alert rules + tier policy: automatic internal watch, drafted public warning | BE |
| 4.2 | Notification channels: app (FCM push + inbox) and SMS (sandbox; gateway only after H14 DLT/cost clearance). Delivery log. | BE (channels), MOB (FCM receipt) |
| 4.3 | Public warning approval UI + dispatch log view | FE |
| 4.4 | Mobile inboxes: field (watch/tasks) and citizen (warnings), acknowledge | MOB |
| 4.5 | Report moderation (citizen) + verification (field) UI and API | FE, BE |
| 4.6 | Verified `ROAD_BLOCKED` report → segment `BLOCKED` → village access flags. Authority reopen. | BE, FE |
| 4.7 | Response priority rules (risk × verified evidence × exposure incl. facilities and blocked access × recency) + panel | BE, FE |

**Dependencies:** Phase 3 (Phase 2 B0 is acceptable if Phase 3 slips).

**Acceptance criteria**
- A High cell automatically dispatches a watch to field officers without manual action, and this is logged.
- A public warning cannot dispatch without approval (API-enforced, tested).
- Each dispatch is logged per channel. SMS shows `SANDBOXED` or `SENT`, and is never faked as sent.
- A verified road-blocked report changes road status and the priority ranking, with reasons.

**Delivers:** OR-07, OR-14, OR-20. OR-12 complete at lightweight level.

---

## Phase 5 — Offline & Multilingual

**Goal:** Low-network robustness and multilingual notifications.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 5.1 | Offline queue hardening: retries, backoff, report data before media, resumable media retry | MOB |
| 5.2 | Batch sync endpoint + duplicate/partial-sync handling | BE |
| 5.3 | Offline cache: last-known risk for the user's area, received alerts | MOB |
| 5.4 | Notification templates in en + hi + pilot-area language, native-speaker reviewed, SMS length and encoding checked | PC (content), BE (rendering) |
| 5.5 | Language selection per user. Alert rendering per language on app and SMS. | BE, MOB, FE |
| 5.6 | Offline test suite: no network, partial sync, duplicate, conflict, app restart | MOB, BE |

**Dependencies:** Phases 2 and 4.

**Acceptance criteria**
- An airplane-mode report with photo and video survives an app restart and syncs exactly once. Media retries don't duplicate the report.
- Cached risk and alerts are viewable offline, with a "last updated" time.
- One alert renders correctly in all three languages in the app and in the SMS log.

**Delivers:** OR-15, OR-16. OR-21 (offline sync).

---

## Phase 6 — Advanced Intelligence (post-MVP)

**Goal:** Promote integration-ready items to real connections, and improve the models, **only when the MVP is stable**.

| # | Candidate | Promotes | Owner |
|---|---|---|---|
| 6.1 | Live IMD API adapter (once access is granted), implemented against IMD documentation | OR-17 → connected | BE, ML |
| 6.2 | Live IMERG feed | OR-18 → connected | ML |
| 6.3 | Physical sensor node / partner gateway | OR-02, OR-19 → real | ML, BE |
| 6.4 | Trained Stage B model with temporal validation (if dated events suffice) | OR-06 depth | ML |
| 6.5 | Forecast-risk hindcast validation with archived forecasts | OR-13 depth | ML |
| 6.6 | Sentinel-2 change detection. Sentinel-1/InSAR feasibility. | OR-03, OR-18 depth | ML |
| 6.7 | Road network routing (reachability, alternates) | OR-12 depth | BE |
| 6.8 | Production SMS gateway, IVR, cell broadcast via authorised channels | OR-20 depth | BE, PC |
| 6.9 | High-availability cloud, message queue, service split | OR-21 depth | BE |
| 6.10 | Offline map tiles, SMS-based reporting | OR-16 depth | MOB, BE |

**Acceptance criteria:** each promotion is demonstrably real (status panel changes honestly). Model changes improve results under the Phase 3 validation protocol. The MVP demo smoke test still passes.

---

## Phase 7 — Demo & Production Hardening

**Goal:** A reliable, honest jury demo that visibly covers every official requirement.

**Tasks**
| # | Task | Owner |
|---|---|---|
| 7.1 | Demo scenario (replay rainfall, forecast, virtual sensors, demo users) + one-command reset | BE (reset), ML (scenario) |
| 7.2 | End-to-end smoke test of the demo flow, incl. requirement coverage checklist | BE (lead), FE, MOB |
| 7.3 | Cloud deployment hardening + laptop fallback stack | BE |
| 7.4 | Security pass: RBAC, sensor API keys, upload validation, secrets, citizen data | BE |
| 7.5 | Performance: map load, video upload on a slow network | FE, MOB, BE |
| 7.6 | UI polish, disclaimers, status labels review | FE, MOB, PC |
| 7.7 | Pitch deck with architecture + integration-status slide, script, jury Q&A sheet | PC |
| 7.8 | Backup demo video + per-requirement clips | VID |
| 7.9 | Rehearsals (≥3 timed full runs + failure drill) | PC (lead), all |

**Dependencies:** Phases 1–5.

**Acceptance criteria**
- The demo runs within the time plan in three consecutive rehearsals. Every OR-01 to OR-21 is shown at its declared class.
- Reset takes under 1 minute. The backup video covers the full story.
- Every simulated, sandboxed or awaiting-access element is visibly labelled.
- No open critical/high security issue.
