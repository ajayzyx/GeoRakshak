# GeoRakshak

**AI-powered landslide risk monitoring and early-warning decision-support system for the North Eastern Region of India.**

Smart India Hackathon 2026 — Problem Statement **SIH26001**: *AI-Based Early Warning and Landslide Risk Monitoring System in NER.*

> **Status:** Implementation in progress. A backend (FastAPI + PostGIS), web dashboard and mobile app run locally. The **provisional pilot (Aizawl, Mizoram; not yet signed off)** is loaded from real historical data: Copernicus DEM terrain, ESA WorldCover, the GSI surveyed landslide inventory (132 records in the pilot) plus NASA's catalogue and a CC-BY research dataset, OpenStreetMap roads and facilities, and IMD gridded rainfall for replay. **Two of those sources — GSI and IMD — allow reproduction only with prior written permission, so they are development-only until that is obtained.** Risk comes from a transparent, **uncalibrated** rule-based baseline (`b0-rules`) with no demonstrated accuracy. There is **no trained model, cloud deployment or live external integration yet.** Everything below describes the approved MVP target unless stated otherwise. See [docs/development.md](docs/development.md).

> **Disclaimer:** GeoRakshak is a decision-support tool. It is **not** an official government warning authority and does not predict the exact time or place of landslides. Public warnings require human approval, and official warnings remain with the mandated agencies.

---

## What it does

```
Rainfall + soil moisture sensors + satellite imagery + terrain + landslide history
        ↓
AI/ML risk assessment (current + weather-linked forecast), with explanations
        ↓
GIS visualization: severity levels, vulnerable roads, villages, infrastructure
        ↓
Automated internal watches · human-approved public warnings (app + SMS, multilingual)
        ↓
Geo-tagged citizen/field photo/video reports (offline-capable)
        ↓
Road connectivity status · response prioritisation
```

## MVP scope (planned)

Each official SIH26001 requirement is mapped to a compliance class in [docs/problem-statement.md](docs/problem-statement.md) and [docs/product-spec.md](docs/product-spec.md):
- **Core:** works end-to-end on real data.
- **Lightweight:** works with reduced scope or labelled simulated/sandbox inputs.
- **Integration-ready:** the interface exists, no real source is connected.

| # | MVP feature | Class |
|---|---|---|
| F1 | GIS risk map with severity levels and layers (landslide history, satellite, villages/facilities, roads, sensors, reports) | Core (satellite layers: Lightweight) |
| F2 | AI risk scoring: trained susceptibility model + rainfall trigger + sensor adjustment, with explanations | Core |
| F3 | Weather-linked risk forecast (+24/48/72 h) | Lightweight |
| F4 | Environmental ingestion adapters, virtual soil moisture sensors, **data-source status panel** | Core / Lightweight / Integration-ready |
| F5 | Vulnerable roads, villages and infrastructure + **road connectivity status** | Core / Lightweight |
| F6 | Geo-tagged photo and limited video (≤30 s) reporting, field officer and citizen modes (citizen reports moderated) | Core |
| F7 | Offline-first mobile: report queue, cached risk and alerts | Core |
| F8 | Automated tiered warnings: automatic internal watches, human-approved public warnings, app + SMS channels | Core / Lightweight |
| F9 | Multilingual notifications (English, Hindi, one pilot-area language) | Core |
| F10 | Report verification and emergency response prioritisation | Core |
| F11 | Cloud deployment (single region) with offline sync, plus laptop fallback | Lightweight |

## Data and integration status (planned MVP, honestly labelled)

**Nothing below is connected or loaded yet, and no data source has been verified.** This is the target state for the prototype. The running system will show each item's live status on its dashboard panel. Full source register: [docs/data-strategy.md §1a](docs/data-strategy.md).

### Real data (planned; verification in Phase 0)
| Data | Official req | Label |
|---|---|---|
| IMD gridded daily rainfall (historical files) | OR-01 | `REAL_HISTORICAL` |
| Elevation model → slope, relief, curvature (Copernicus DEM; SRTM/CartoDEM backup) | OR-04 | `REAL_HISTORICAL` |
| Landslide inventory: GSI surveyed records via the Bhusanket portal (primary); NASA Global Landslide Catalog and licensed research datasets (secondary) | OR-05 | `REAL_HISTORICAL` |
| Satellite-derived layers: Sentinel-2 composite (vegetation, imagery), ESA WorldCover. Precomputed, with acquisition dates. | OR-03 | `REAL_HISTORICAL` |
| Roads, villages, facilities (OpenStreetMap, © OpenStreetMap contributors) | OR-09 | `REAL_HISTORICAL` |
| Administrative boundaries (Survey of India, LGD codes) | — | `REAL_HISTORICAL` |
| Live forecast and recent rainfall: IMD if access is granted, otherwise Open-Meteo **labelled non-IMD, model output not gauge data** (adapter built, verified with a real call, off by default) | OR-13 | `REAL_LIVE`, only once really connected |

### Simulated, virtual or sandboxed (clearly labelled in the UI)
| Item | Official req | Label |
|---|---|---|
| Soil moisture sensors: **virtual stations** posting through the real sensor ingestion API | OR-02 | `SIMULATED_DEMO` · "Virtual sensor (simulated)" |
| Demo rainfall replay (a real historical period preferred, otherwise synthetic) and replay forecast | OR-01, OR-13 | `REAL_HISTORICAL` or `SIMULATED_DEMO` |
| SMS warnings: rendered and logged, **not sent** | OR-20 | `SANDBOX` / delivery status `SANDBOXED` |
| Demo users, field and citizen reports, photos/videos (team-captured) | OR-10 | `SIMULATED_DEMO` |
| Risk, forecast risk, road status, priority | OR-06, 12, 13, 14 | `MODEL_OUTPUT` (with input labels) |

### Integration-ready adapters (interface exists, **not connected**)
| Adapter | Official req | Dashboard status |
|---|---|---|
| IMD weather API | OR-17 | `AWAITING_ACCESS` (access to be requested in Phase 0) |
| Satellite feed: GPM IMERG | OR-18 | `NOT_CONNECTED` (connected only if the feasibility check succeeds) |
| Real sensor gateway / partner sensor network | OR-19 | `NOT_CONNECTED` |
| SMS gateway mode | OR-20 | Off until DLT compliance and cost are cleared |

Real in the MVP once built: app notifications (FCM push with in-app inbox fallback) and single-region cloud deployment with a laptop fallback (OR-07, OR-20, OR-21).

### Post-MVP integrations (planned, not in the prototype)
- Physical soil moisture / rain gauge / tilt sensor networks (LoRa/MQTT gateways)
- Live IMD API, live IMERG and recurring Sentinel-2/Sentinel-1 feeds, InSAR
- Production SMS gateway, IVR, cell broadcast via authorised channels
- Official road-status feeds, and road route calculation
- NDMA SACHET official-alert overlay
- High-availability multi-zone cloud, message queues, CDN

## Architecture (planned)

One Python + FastAPI backend deployable (API, scheduled monitoring/replay, weather/sensor/satellite adapters, data-source status registry, imported `georakshak_ml` package, notification abstraction), PostgreSQL + PostGIS, object storage, web dashboard and an offline-first Android app. It is deployed to one cloud region with a laptop fallback. See [docs/architecture.md](docs/architecture.md).

## Documentation

| Doc | Contents |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Engineering, data-integrity and Git ownership rules (read first) |
| [docs/problem-statement.md](docs/problem-statement.md) | Official SIH26001 requirements and our mapping |
| [docs/product-spec.md](docs/product-spec.md) | Compliance matrix, users, journeys, features, success criteria |
| [docs/architecture.md](docs/architecture.md) | Architecture, adapters, status registry, decisions |
| [docs/data-strategy.md](docs/data-strategy.md) | Data sources, verification status, licences |
| [docs/ml-strategy.md](docs/ml-strategy.md) | Models, validation, explainability, limitations |
| [docs/database.md](docs/database.md) | Conceptual MVP schema |
| [docs/api.md](docs/api.md) | Frozen MVP API contract v1 (implemented in `backend/`) |
| [docs/roadmap.md](docs/roadmap.md) | Phases 0–7 |
| [docs/team.md](docs/team.md) | Roles and ownership |
| [docs/demo.md](docs/demo.md) | 4-minute core jury demo |
| [docs/development.md](docs/development.md) | Engineering contract: layout, ports, run commands, ML handoff |

## Team

Frontend · Backend · AI/ML · Mobile · Video · Product/Communication. See [docs/team.md](docs/team.md).

## License

To be decided (pending approval, H12). Third-party datasets keep their own licences and attribution requirements. See [docs/data-strategy.md](docs/data-strategy.md).
