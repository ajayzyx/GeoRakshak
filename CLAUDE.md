# CLAUDE.md — GeoRakshak

This file guides Claude Code, and any human contributor, working in this repository.
Read it fully before making changes. When this file and a request conflict, stop and ask.

---

## 1. Project context

- **Project:** GeoRakshak
- **Event:** Smart India Hackathon (SIH) 2026
- **Problem statement ID:** SIH26001 — *AI-Based Early Warning and Landslide Risk Monitoring System in NER*
- **One-line description:** An AI-powered landslide risk monitoring and early-warning **decision-support** system for the North Eastern Region (NER) of India.
- **Repository status:** Implementation in progress (parallel tracks: backend, web, mobile, ML). No trained model yet. See [docs/development.md](docs/development.md).

Core flow:

```
Environmental data → Risk analysis → AI-assisted risk assessment → GIS visualization
→ Early warning → Field verification → Authority response
```

Key documents:

| Document | Purpose |
|---|---|
| [docs/problem-statement.md](docs/problem-statement.md) | SIH26001: official requirements (authoritative) vs. our implementation |
| [docs/product-spec.md](docs/product-spec.md) | Users, journeys, MVP and future features |
| [docs/architecture.md](docs/architecture.md) | Approved MVP architecture, adapters, status registry, decision status |
| [docs/data-strategy.md](docs/data-strategy.md) | Candidate data sources and their constraints |
| [docs/ml-strategy.md](docs/ml-strategy.md) | Prediction target, models, validation, explainability |
| [docs/database.md](docs/database.md) | Conceptual schema |
| [docs/api.md](docs/api.md) | Frozen MVP API contract v1 and internal interfaces (not implemented) |
| [docs/roadmap.md](docs/roadmap.md) | Phases 0–7 |
| [docs/team.md](docs/team.md) | Ownership |
| [docs/demo.md](docs/demo.md) | Jury demo: 4-minute core, 5-minute hard stop |
| [docs/development.md](docs/development.md) | Engineering contract: layout, ports, ML interface, handoff files, milestones |
| [docs/gsi-access-request.md](docs/gsi-access-request.md) | GSI permission and data-access checklist (request not yet sent) |

## 2. Problem statement

Landslides in NER cause loss of life, cut off road links and isolate villages, especially during the monsoon. Terrain is steep, rainfall is heavy, and field access is hard. Authorities need to know **where** risk is rising, **why**, and **what to respond to first**. They also need verified information from the ground.

The **official SIH26001 requirement list** is recorded verbatim in [docs/problem-statement.md §1.1](docs/problem-statement.md) and is the **authoritative requirement source**. It explicitly requires:
- rainfall patterns, soil moisture sensors, satellite imagery, terrain/slope data and historical landslide records
- AI/ML identification of high-risk zones and prediction of possible landslide events
- real-time alerts and GIS visualization of vulnerable roads, villages and infrastructure
- geo-tagged citizen/field photo/video reporting
- risk severity levels, road connectivity status and weather-linked risk forecasts
- emergency response prioritisation and multilingual notifications
- low-network/offline functionality
- integration with IMD weather APIs, satellite feeds and sensor data
- automated SMS/app-based early warning
- a cloud-based architecture with offline sync

These are referenced as OR-01 to OR-21. Do not add, drop or paraphrase official requirements. Portal metadata not yet provided (organisation, category, theme) stays marked as not provided.

## 3. Product vision

GeoRakshak gives district and state disaster-management authorities one explainable view of landslide risk. The view links environmental risk signals, AI-assisted assessment, geo-tagged field evidence and prioritised response.

GeoRakshak **is**:
- A decision-support platform that helps humans decide faster and with better evidence.

GeoRakshak **is not**:
- An official government warning authority. Official warnings stay with the mandated agencies.
- A system that can predict landslides perfectly. It estimates **risk**, with stated uncertainty.

## 4. MVP scope

**Every official requirement (OR-01 to OR-21) has an MVP representation.** Each is classified in [docs/product-spec.md §2](docs/product-spec.md):
- **1 CORE:** real, end-to-end.
- **2 LIGHTWEIGHT:** end-to-end, with reduced scope or labelled simulated/sandbox inputs.
- **3 INTEGRATION-READY:** interface exists, nothing connected, status shown honestly.
- **4 POST-MVP:** designed only.

Approved MVP features (one pilot area):

| # | Feature | Class |
|---|---|---|
| F1 | GIS risk map with severity levels and layers | CORE (satellite layers LIGHTWEIGHT) |
| F2 | AI risk scoring: trained susceptibility model + rainfall trigger + sensor adjustment, with explanations | CORE |
| F3 | Weather-linked risk forecast (+24/48/72 h) | LIGHTWEIGHT |
| F4 | Ingestion adapters, virtual soil moisture sensors via the real sensor API, data-source status registry | CORE / LIGHTWEIGHT / INTEGRATION-READY |
| F5 | Vulnerable roads, villages, infrastructure + road connectivity status (segment level, no routing) | CORE / LIGHTWEIGHT |
| F6 | Geo-tagged photo/video (≤30 s) reporting, field officer and citizen modes | CORE |
| F7 | Offline-first mobile: queue, cached risk and alerts | CORE |
| F8 | Automated tiered warnings through app + SMS (SMS in sandbox by default) | CORE / LIGHTWEIGHT |
| F9 | Multilingual notifications (en, hi, one pilot-area language) | CORE |
| F10 | Report verification and response prioritisation | CORE |
| F11 | Single-region cloud deployment with offline sync, laptop fallback | LIGHTWEIGHT |

**Integration-ready in the MVP (interface only, never presented as connected):**
- IMD weather API (`AWAITING_ACCESS`)
- satellite feed, first target IMERG (`NOT_CONNECTED`)
- generic sensor gateway (`NOT_CONNECTED`)

**Post-MVP depth** (see [docs/roadmap.md](docs/roadmap.md) Phase 6):
- physical sensor networks
- live IMD/IMERG/Sentinel feeds
- change detection and InSAR
- trained time-based model
- road route calculation
- production SMS gateway, IVR and cell broadcast
- high-availability cloud
- offline map tiles

## 4a. Alert policy (approved)

| Tier | Trigger | Audience | Approval | Channels |
|---|---|---|---|---|
| `WATCH` (internal) | Cell reaches High (current or forecast) | Field officers, control room | **May be automated** | App (+ SMS if enabled) |
| `WARNING` (public) | Very High, or High + verified report | Citizens in the affected area | **Human approval required** | App + SMS |
| `UPDATE` / all-clear | Authority action | Previous recipients | Human | App + SMS |

- A public `WARNING` must never be dispatched without a recorded human approval, enforced in the API and tested.
- SMS runs in `SANDBOX` mode (render + log, **not sent**). Gateway mode may be enabled only after DLT compliance and cost are cleared and documented (H14). Sandbox deliveries must never be shown as sent.
- GeoRakshak remains decision support, not an official warning authority.

## 5. Current architecture decisions

Status legend: **PROPOSED** = documented but not approved. **APPROVED** = agreed by the team. **PENDING HUMAN APPROVAL** = must not be implemented until someone approves it.

| # | Decision | Status |
|---|---|---|
| A1 | Components: web dashboard, offline-first mobile app (field + citizen modes), **one Python backend deployable** (API, scheduler, adapters, notification service, imported ML package), PostgreSQL + PostGIS, object storage | APPROVED |
| A2 | PostgreSQL + PostGIS as the single system of record for spatial data | APPROVED |
| A3 | AI/ML ships as the `georakshak_ml` Python package **imported by the backend** (replaces the earlier separate ML service; the package boundary allows a later split) | APPROVED (H13) |
| A4 | Notification/alert service is a backend module with pluggable channels (app push, app inbox, SMS) | APPROVED |
| A5 | Every stored data record carries a provenance label, and every adapter/channel carries a connection status (see §9) | APPROVED |
| A6 | Tiered alert policy: internal `WATCH` may be automated, public `WARNING` requires human approval (see §4a) | APPROVED (H15) |
| A7 | Adapter interfaces (`WeatherProvider`, `SatelliteSource`, `SensorSource`, `NotificationChannel`) + data-source status registry | APPROVED |
| A8 | Single-region cloud deployment + laptop fallback running the same containers. Cheapest reliable provider. | APPROVED (H6) |
| A9 | SMS channel defaults to `SANDBOX`. Gateway mode only after DLT compliance and cost are cleared. | APPROVED (H14) |
| A10 | Citizens use demo accounts in the MVP | APPROVED (H18) |
| A11 | Backend: **Python + FastAPI**. Web and mobile frameworks chosen by owner skill from the approved options in [docs/architecture.md §9](docs/architecture.md). | APPROVED (H1, H2, H3). Owners record their choice in Phase 0. |
| A12 | Pilot area chosen by landslide inventory count and data coverage | APPROVED criterion (H4). Area selected in the Phase 0 data spike. |
| A13 | Basemap after terms check (H5); cloud bucket for media (H7); push via FCM with inbox polling fallback (H8); notifications in English + Hindi + one pilot-area language (H9); forecast from IMD if access is granted, else an approved provider labelled non-IMD (H16); no physical sensor node by default (H17) | APPROVED |
| A14 | Final data sources per layer (H10), severity thresholds (H11), project licence (H12), media retention period | PENDING HUMAN APPROVAL |

The full list of decisions and options is in [docs/architecture.md](docs/architecture.md). Do not change a decision's status in code or docs without explicit confirmation from a team member.

## 6. Engineering rules

1. **Reliable MVP first.** Finish a working end-to-end vertical slice before adding advanced features.
2. **Trace to SIH26001.** Every major feature must map to a requirement or MVP item in [docs/problem-statement.md](docs/problem-statement.md). If it doesn't, it waits.
3. **Minimal dependencies.** Add a dependency only when it removes real work or risk. Justify it in the PR description.
4. **No unapproved technology.** Do not introduce frameworks, services, cloud providers or paid APIs listed as PENDING HUMAN APPROVAL.
5. **Design for scale, build for now.** Use clear module boundaries and a versioned API, but don't add microservices, queues or caches before the MVP needs them.
6. **Secrets never in Git.** Use environment variables and a committed `.env.example` with placeholder values only.
7. **Spatial correctness.** Store geometries in EPSG:4326. Reproject explicitly for distance/area work. Never mix CRSs silently.
8. **Fail visibly.** If data is stale, missing or simulated, the UI and API must say so. They must never silently fall back.
9. **Docs stay current.** A change to architecture, schema, API or data sources updates the matching file in `docs/` in the same PR.

## 7. Coding conventions

The backend is Python + FastAPI (approved). Web and mobile tooling is fixed when the owners record their framework choice (A11). Until then:

- **Naming:** `snake_case` for database tables/columns and Python; `camelCase` for JavaScript/TypeScript variables; `PascalCase` for types/components; `kebab-case` for file names in `docs/` and web routes.
- **API:** JSON over HTTPS, versioned under `/api/v1`, GeoJSON (RFC 7946) for spatial payloads, ISO 8601 UTC timestamps, UUID identifiers.
- **Units:** SI units, stated in field names where ambiguous (`rainfall_mm_24h`, `slope_deg`, `elevation_m`).
- **Formatting and linting:** use the standard formatter and linter for each language, enforced in CI. Don't hand-format.
- **Types:** type-annotate public functions. Use strict mode where the language supports it.
- **Comments:** explain *why*, not *what*. Cite the source for any scientific constant or threshold.
- **Small units:** keep functions and modules focused. Prefer small PRs.
- **No dead code or commented-out blocks** in merged code.

## 8. Testing rules

1. Every backend endpoint has at least one success test and one failure/validation test.
2. Risk-scoring logic, both rule-based and ML, has deterministic unit tests with fixed inputs and expected outputs.
3. Spatial queries are tested against a small, committed fixture dataset labelled `SIMULATED_DEMO`.
4. The offline queue is tested for: no network, partial sync, duplicate submission (idempotency), and conflict.
5. ML changes include an evaluation report (see [docs/ml-strategy.md](docs/ml-strategy.md)). Results must not regress without a written justification.
6. Tests must not call live external APIs. Use recorded fixtures.
7. CI must pass before merge. Never skip, disable or weaken a test to make CI green.
8. The demo flow in [docs/demo.md](docs/demo.md) gets an end-to-end smoke test before any jury presentation, including its official-requirement coverage checklist.
9. Adapter and channel tests use GeoRakshak's own normalised types and fixtures. Never invent an external provider's request/response format for a test.
10. The alert policy is tested: a public `WARNING` cannot dispatch without approval, `AUTO_DISPATCHED` applies only to `WATCH`, and sandbox SMS is never `SENT`.
11. Sensor ingestion is tested for bad keys, invalid units/ranges and duplicate readings.

## 9. Data integrity rules

Every dataset, table row that holds environmental or risk data, API response and UI element that shows such data must be labelled with exactly one provenance class:

| Label | Meaning |
|---|---|
| `REAL_LIVE` | Fetched from a real external source recently (freshness shown) |
| `REAL_HISTORICAL` | Real archived data from a documented source |
| `SIMULATED_DEMO` | Synthetic or scripted data created by the team for testing or demo |
| `MODEL_OUTPUT` | Produced by our rule engine or ML model, with the model version recorded |

Rules:

1. **Never fabricate real-world data.** Do not invent landslide events, casualty figures, rainfall readings, village names or coordinates presented as real.
2. **Never invent data sources or API endpoints.** Record a source only if it has been checked to exist. Mark anything unverified as `UNVERIFIED`.
3. Simulated data must be visibly marked in the UI (for example a "SIMULATED" badge) and in filenames (`*_simulated.*`).
4. Every ingested dataset records: source, dataset name, retrieval time, licence, spatial/temporal coverage and processing steps.
5. Respect licences. Record attribution requirements, and don't redistribute data whose licence forbids it.
6. Field reports are user-generated and start as `UNVERIFIED`. Only an authorised reviewer can mark them `VERIFIED` or `REJECTED`.
7. Personal data (phone numbers, names, precise home locations) is collected only when needed, access-controlled and never committed to Git.
8. **Connection status honesty.** Every adapter and notification channel has exactly one status: `CONNECTED_LIVE`, `CONNECTED_HISTORICAL`, `SIMULATED`, `SANDBOX`, `AWAITING_ACCESS` or `NOT_CONNECTED`. A status may become `CONNECTED_LIVE` only after a successful real call to a real source. Never set it that way in seed data, fixtures or demo scripts.
9. **Integration-ready never means integrated.** Docs, UI, pitch and demo must not describe the IMD API, satellite feeds or sensor gateways as connected until they really are.
10. **Virtual sensors** are always `SIMULATED_DEMO`, labelled "Virtual sensor (simulated)" in the UI, and never used for training or reported metrics.
11. **Forecasts** are stored and shown separately from observations, with source, issue time and lead time. Non-IMD forecast sources are labelled as non-IMD.
12. **Satellite layers** always show their acquisition date range. Never present an old image as current.

## 10. AI/ML rules

1. **Risk, not certainty.** Outputs are risk scores or classes with uncertainty or confidence. Never use wording like "landslide will occur".
2. **Explainability is mandatory.** Every score shown to a user includes its top contributing factors in plain language.
3. **Baseline first.** A transparent rule-based or logistic-regression baseline must exist and be evaluated before any complex model.
4. **Spatially honest validation.** Use spatial (and, where relevant, temporal) cross-validation. Random splits of neighbouring cells are not acceptable as headline results.
5. **Reproducibility.** Record the model version, training data version, feature list, hyperparameters, random seed and metrics for every model used by the service.
6. **No training on simulated data for reported metrics.** Simulated data (including virtual sensor readings) may be used to test pipelines and the rule-based sensor adjustment only.
7. **Human in the loop for public warnings.** A model output may trigger an automated internal `WATCH` and may *draft* a public `WARNING`. It can never dispatch a public warning (see §4a).
8. **State limitations.** Each model version ships with a model card that states known limitations and biases.
9. Do not use LLMs to generate risk scores. If LLMs are ever used (for example for translation drafts), their output must be reviewed by a person and labelled.
10. **Forecast accuracy is not claimed** until it has been evaluated against archived forecasts. `forecast_skill_evaluated` stays false until then.
11. **Sensor adjustment is a bounded, documented rule,** not a trained component, while no real historical sensor data exists.

## 11. Git workflow

- **Default branch:** `main`, always demo-able. No direct commits to `main` once the first commit exists.
- **Branches:** `<type>/<area>-<short-description>`, for example `feat/web-risk-map`, `fix/api-report-validation`, `docs/data-strategy-imd`.
  - Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `data`, `ml`.
  - Areas: `web`, `mobile`, `api`, `ml`, `data`, `db`, `alerts`, `infra`, `docs`.
- **Commits:** Conventional Commits (`feat(api): add field report endpoint`).
- **Pull requests:** one concern per PR. The description links the roadmap task, lists doc updates, and notes new dependencies and data provenance.
- **Review:** at least one approval, and it must come from the owner of the affected area (see [docs/team.md](docs/team.md)).
- **Never commit:** secrets, `.env`, raw large datasets, model binaries over a few MB, or personal data. Use documented download scripts or external storage instead.

## 12. Rules for future Claude Code sessions

1. **Read before acting.** Read this file and the docs relevant to the task before writing code.
2. **Stay in the current phase.** Check [docs/roadmap.md](docs/roadmap.md). Don't implement later-phase features unless asked.
3. **Respect approval gates.** If a task needs a decision marked PENDING HUMAN APPROVAL, stop and ask. Don't pick a default silently.
4. **No fabrication.** Don't invent requirements, data sources, endpoints, datasets, statistics or citations. If something is unknown, say so and mark it `UNVERIFIED` or `TODO(verify)`.
5. **Don't install dependencies or create infrastructure** (databases, cloud resources, external accounts) without explicit instruction.
6. **Keep docs in sync.** Update the matching `docs/` file whenever you change architecture, schema, API, data sources or ML approach.
7. **Label provenance.** Any sample, fixture or seed data you create is `SIMULATED_DEMO` and named accordingly.
8. **Small, verifiable steps.** Prefer small changes with tests. Report exactly what was and wasn't verified.
9. **Git:** don't commit, push or open PRs unless asked. When asked, follow §11.
10. **Safety language:** in UI copy, docs and demo material, describe GeoRakshak as decision support, never as an official warning authority.
11. **Official requirements are fixed.** Map work to OR-01 to OR-21 ([docs/problem-statement.md](docs/problem-statement.md)). Never silently drop or downgrade a requirement's MVP representation. Propose changes to its class explicitly.
12. **No invented integrations.** Don't invent IMD, satellite, sensor hardware, SMS gateway or push provider formats, credentials or connections. Mark them `AWAITING_ACCESS`, `NOT_CONNECTED`, `UNVERIFIED` or `TODO(verify)`.


## Git Ownership

The human developer owns the Git history.

Claude MUST NOT:
- create commits
- amend commits
- push to remote repositories
- force push
- rebase
- reset commits
- modify Git history

Claude MAY:
- inspect git status
- inspect git diff
- inspect repository history
- run tests
- report changed files

The human developer will review, stage, commit, and push changes manually.