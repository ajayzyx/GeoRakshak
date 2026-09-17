# GeoRakshak

**AI-powered landslide risk monitoring and early-warning decision-support system for the North Eastern Region of India.**

Smart India Hackathon 2026 — Problem Statement **SIH26001**: *AI-Based Early Warning and Landslide Risk Monitoring System in NER.*

> **Status:** Project initialization. This repository currently contains documentation only. There is no application code, database or trained model yet.

> **Disclaimer:** GeoRakshak is a decision-support tool. It is **not** an official government warning authority and does not guarantee landslide prediction. Official warnings are issued by the mandated agencies.

---

## What it does

```
Environmental data
        ↓
Risk analysis
        ↓
AI-assisted risk assessment
        ↓
GIS visualization
        ↓
Early warning
        ↓
Field verification
        ↓
Authority response
```

## MVP features

1. GIS-based risk map
2. Location-level landslide risk score
3. Explainable risk factors
4. Geo-tagged field incident reporting
5. Photo/video evidence
6. Authority dashboard
7. Alert generation (human-approved)
8. Offline field-report queue
9. Basic multilingual warning support

## Proposed components

| Component | Role |
|---|---|
| Web application | Authority dashboard and GIS risk map |
| Mobile application | Field officer reporting with offline queue |
| Backend API | Auth, business logic, spatial queries |
| PostgreSQL + PostGIS | System of record for spatial and operational data |
| AI/ML service | Risk scoring and explanations |
| Data ingestion | Scheduled acquisition of environmental datasets |
| Alert service | Drafting, approval and delivery of alerts |

Frameworks and hosting are **pending team approval**. See [docs/architecture.md](docs/architecture.md).

## Data honesty

Every data point in GeoRakshak is labelled with one of the following:
`REAL_LIVE` · `REAL_HISTORICAL` · `SIMULATED_DEMO` · `MODEL_OUTPUT`

## Documentation

| Doc | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Engineering rules and conventions (read first) |
| [docs/problem-statement.md](docs/problem-statement.md) | SIH26001 requirements vs. our implementation |
| [docs/product-spec.md](docs/product-spec.md) | Users, journeys, features, success criteria |
| [docs/architecture.md](docs/architecture.md) | System architecture and open decisions |
| [docs/data-strategy.md](docs/data-strategy.md) | Data sources and constraints |
| [docs/ml-strategy.md](docs/ml-strategy.md) | ML approach, validation, explainability |
| [docs/database.md](docs/database.md) | Conceptual database schema |
| [docs/api.md](docs/api.md) | Proposed API |
| [docs/roadmap.md](docs/roadmap.md) | Phases 0–7 |
| [docs/team.md](docs/team.md) | Roles and ownership |
| [docs/demo.md](docs/demo.md) | 3-minute jury demo plan |

## Team

Frontend · Backend · AI/ML · Mobile · Video · Product/Communication. See [docs/team.md](docs/team.md).

## License

To be decided by the team (pending human approval). Third-party datasets keep their own licences. See [docs/data-strategy.md](docs/data-strategy.md).
