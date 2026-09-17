# CLAUDE.md — GeoRakshak

This file guides Claude Code, and any human contributor, working in this repository.
Read it fully before making changes. When this file and a request conflict, stop and ask.

---

## 1. Project context

- **Project:** GeoRakshak
- **Event:** Smart India Hackathon (SIH) 2026
- **Problem statement ID:** SIH26001 — *AI-Based Early Warning and Landslide Risk Monitoring System in NER*
- **One-line description:** An AI-powered landslide risk monitoring and early-warning **decision-support** system for the North Eastern Region (NER) of India.
- **Repository status:** Documentation foundation only. No application code, dependencies, database, or trained model exists yet.

Core flow:

```
Environmental data → Risk analysis → AI-assisted risk assessment → GIS visualization
→ Early warning → Field verification → Authority response
```

Key documents:

| Document | Purpose |
|---|---|
| [docs/problem-statement.md](docs/problem-statement.md) | SIH26001: official requirements vs. our interpretation |
| [docs/product-spec.md](docs/product-spec.md) | Users, journeys, MVP and future features |
| [docs/architecture.md](docs/architecture.md) | Proposed system architecture and pending decisions |
| [docs/data-strategy.md](docs/data-strategy.md) | Candidate data sources and their constraints |
| [docs/ml-strategy.md](docs/ml-strategy.md) | Prediction target, models, validation, explainability |
| [docs/database.md](docs/database.md) | Conceptual schema |
| [docs/api.md](docs/api.md) | Proposed API boundaries |
| [docs/roadmap.md](docs/roadmap.md) | Phases 0–7 |
| [docs/team.md](docs/team.md) | Ownership |
| [docs/demo.md](docs/demo.md) | 3-minute jury demo |

## 2. Problem statement

Landslides in NER cause loss of life, cut off road links and isolate villages, especially during the monsoon. Terrain is steep, rainfall is heavy, and field access is hard. Authorities need to know **where** risk is rising, **why**, and **what to respond to first**. They also need verified information from the ground.

The authoritative wording of SIH26001 must be copied into [docs/problem-statement.md](docs/problem-statement.md) from the official SIH portal. Do not paraphrase requirements that we have not seen in the official text.

## 3. Product vision

GeoRakshak gives district and state disaster-management authorities one explainable view of landslide risk. The view links environmental risk signals, AI-assisted assessment, geo-tagged field evidence and prioritised response.

GeoRakshak **is**:
- A decision-support platform that helps humans decide faster and with better evidence.

GeoRakshak **is not**:
- An official government warning authority. Official warnings stay with the mandated agencies.
- A system that can predict landslides perfectly. It estimates **risk**, with stated uncertainty.

## 4. MVP scope

In scope:

1. GIS-based risk map
2. Location-level landslide risk score
3. Explainable risk factors
4. Geo-tagged field incident reporting
5. Photo/video evidence
6. Authority dashboard
7. Alert generation (human-approved)
8. Offline field-report queue
9. Basic multilingual warning support

Out of scope for the MVP (see [docs/roadmap.md](docs/roadmap.md) Phase 6+): IoT sensor integration, real-time InSAR deformation, deep learning on imagery, automated SMS or cell broadcast to the public, run-out/impact modelling, and multi-state production rollout.

## 5. Current architecture decisions

Status legend: **PROPOSED** = documented but not approved. **APPROVED** = agreed by the team. **PENDING HUMAN APPROVAL** = must not be implemented until someone approves it.

| # | Decision | Status |
|---|---|---|
| A1 | Components: web app, mobile app, backend API, PostgreSQL + PostGIS, AI/ML service, data ingestion jobs, alert service | PROPOSED |
| A2 | PostgreSQL + PostGIS as the single system of record for spatial data | PROPOSED |
| A3 | AI/ML runs as a separate Python service behind an internal API | PROPOSED |
| A4 | Alert service starts as a module inside the backend, not a separate deployable | PROPOSED |
| A5 | Every stored data record carries a provenance label (see §9) | PROPOSED |
| A6 | Alerts are drafted by the system and **published only after human approval** | PROPOSED |
| A7 | Language/framework choices for each component | PENDING HUMAN APPROVAL |
| A8 | Pilot geography (district/area) | PENDING HUMAN APPROVAL |
| A9 | Hosting, map tile provider, SMS/notification provider | PENDING HUMAN APPROVAL |

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

Specific tooling will be fixed once decision A7 is approved. Until then:

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
8. The demo flow in [docs/demo.md](docs/demo.md) gets an end-to-end smoke test before any jury presentation.

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

## 10. AI/ML rules

1. **Risk, not certainty.** Outputs are risk scores or classes with uncertainty or confidence. Never use wording like "landslide will occur".
2. **Explainability is mandatory.** Every score shown to a user includes its top contributing factors in plain language.
3. **Baseline first.** A transparent rule-based or logistic-regression baseline must exist and be evaluated before any complex model.
4. **Spatially honest validation.** Use spatial (and, where relevant, temporal) cross-validation. Random splits of neighbouring cells are not acceptable as headline results.
5. **Reproducibility.** Record the model version, training data version, feature list, hyperparameters, random seed and metrics for every model used by the service.
6. **No training on simulated data for reported metrics.** Simulated data may be used to test pipelines only.
7. **Human in the loop.** A model output can *draft* an alert. It can never publish one.
8. **State limitations.** Each model version ships with a model card that states known limitations and biases.
9. Do not use LLMs to generate risk scores. If LLMs are ever used (for example for translation drafts), their output must be reviewed by a person and labelled.

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
