# Architecture — GeoRakshak (Proposed)

> **Status:** PROPOSED. Nothing here is implemented.
> Items marked **🔶 REQUIRES HUMAN APPROVAL** must not be built until a team member approves them and updates this file.

## 1. Goals and constraints

| Goal / constraint | Architectural response |
|---|---|
| Reliable MVP within hackathon time | Few deployables, modular monolith backend, managed or simple infrastructure |
| Spatial data at the core | PostgreSQL + PostGIS as the single spatial system of record |
| Explainable AI | Separate ML service that returns score **and** factor contributions |
| Intermittent connectivity in the field | Offline-first mobile report queue, idempotent sync API |
| Human-in-the-loop warnings | Alert state machine with a mandatory approval step |
| Data honesty | Provenance label stored on every data record and returned by every API |
| Scale later | Versioned API, clear module boundaries, stateless services, a job-based ingestion design |

## 2. System context

```
                         ┌───────────────────────────┐
                         │  External data providers  │
                         │ (rainfall, DEM, inventory,│
                         │  boundaries, OSM, etc.)   │
                         └─────────────┬─────────────┘
                                       │ scheduled pull
                                       ▼
┌──────────────┐   HTTPS   ┌──────────────────────────────────────┐   internal HTTP   ┌──────────────────┐
│  Web app     │◄─────────►│              Backend API              │◄────────────────►│  AI/ML service   │
│ (authorities)│           │ ┌──────────┐ ┌──────────┐ ┌─────────┐ │                  │ (risk scoring +  │
└──────────────┘           │ │ Auth/RBAC│ │ Reports/ │ │ Alert   │ │                  │  explanations)   │
                           │ │          │ │ Evidence │ │ service │ │                  └────────┬─────────┘
┌──────────────┐   HTTPS   │ └──────────┘ └──────────┘ └─────────┘ │                           │ reads features
│  Mobile app  │◄─────────►│ ┌──────────┐ ┌──────────┐ ┌─────────┐ │                           │ writes scores
│ (field, with │           │ │ Risk/GIS │ │ Incidents│ │ Priority│ │                           │
│ offline queue│           │ └──────────┘ └──────────┘ └─────────┘ │                           │
└──────────────┘           └───────────────┬───────────────┬──────┘                           │
                                           │               │                                  │
                                           ▼               ▼                                  │
                           ┌──────────────────────┐  ┌──────────────┐                         │
                           │ PostgreSQL + PostGIS │◄─┼──────────────┼─────────────────────────┘
                           └──────────▲───────────┘  │ Object store │
                                      │              │ (photo/video)│
                           ┌──────────┴───────────┐  └──────────────┘
                           │  Data ingestion jobs │
                           └──────────────────────┘
```

## 3. Components

### 3.1 Web application (authority dashboard)
- **Responsibilities:** risk map, layer toggles, location detail with explanations, alert review/approval, incident and report review, response-priority list, admin screens.
- **Key concerns:** map rendering of vector layers, clear provenance badges, role-based UI.
- **Proposed approach:** a single-page app with an open-source web map library that renders GeoJSON / vector tiles.
- 🔶 **REQUIRES HUMAN APPROVAL:** framework (options: React + TypeScript, or Vue + TypeScript) and map library (options: MapLibre GL JS, or Leaflet).
- 🔶 **REQUIRES HUMAN APPROVAL:** basemap tile source. Public OpenStreetMap tile servers have a usage policy that forbids heavy/production use. Options: a commercial tile provider's free tier, or self-hosted tiles for the pilot area.

### 3.2 Mobile application (field officer)
- **Responsibilities:** login, receive alerts/tasks, view the location on a map, create geo-tagged reports, capture photo/video, offline queue and sync, language selection.
- **Offline design:**
  - Each report gets a client-generated UUID (`client_report_id`) when it is created.
  - Reports and media paths are stored in local on-device storage with status `QUEUED`.
  - The sync worker retries with backoff when connectivity returns. The server treats `client_report_id` as an idempotency key.
  - Metadata syncs first, then media, so a slow video doesn't block the report.
- 🔶 **REQUIRES HUMAN APPROVAL:** framework (options: React Native/Expo, Flutter, or native Android/Kotlin). Consider the Mobile developer's existing skill. Android-first is assumed for the field device.

### 3.3 Backend API
- **Style:** modular monolith exposing a REST API under `/api/v1` (see [api.md](api.md)).
- **Modules:** `auth` (users, roles, tokens), `geo` (locations, risk zones, boundaries, layers), `risk` (read scores, request assessment), `reports` (field reports, evidence), `incidents`, `alerts` (alert service), `priority`, `admin`, `data_sources`.
- **Auth:** token-based auth with role-based access control (roles: `ADMIN`, `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `FIELD_OFFICER`).
- 🔶 **REQUIRES HUMAN APPROVAL:** language/framework. Options:
  - **Python + FastAPI**: same language as ML, strong geospatial libraries. *Recommended* to reduce the number of stacks the team has to learn.
  - **Node.js + TypeScript (e.g. NestJS/Express)**: shares a language with the web frontend.

### 3.4 PostgreSQL + PostGIS
- The system of record for users, spatial layers, observations, risk scores, reports, incidents and alerts (see [database.md](database.md)).
- Geometries stored in EPSG:4326, with GiST indexes on geometry columns.
- Raster data (DEM, slope) is **pre-processed into grid-cell attributes** for the MVP rather than stored as PostGIS rasters, which keeps things simple. Raw rasters stay in file/object storage.
- Schema migrations are managed by a migration tool (chosen with the backend framework).
- 🔶 **REQUIRES HUMAN APPROVAL:** hosting (local Docker for development; managed Postgres vs. a self-managed VM for the demo).

### 3.5 AI/ML service
- **Responsibilities:** load a versioned model, compute risk scores for grid cells or points, return per-feature contributions, and expose model metadata.
- **Interfaces:** internal HTTP API (`/predict`, `/explain`, `/model`) plus a batch scoring job that writes to `risk_assessments`.
- **Language:** Python (standard ML/geospatial ecosystem).
- **Modes:** (1) rule-based baseline, (2) trained ML model. Both return the same response shape so they can be swapped.
- Not exposed publicly. Only the backend and batch jobs call it.
- See [ml-strategy.md](ml-strategy.md).

### 3.6 Data ingestion
- **Static layers** (DEM, slope, boundaries, roads, villages, landslide inventory) are loaded by one-off, versioned, scripted jobs.
- **Dynamic layers** (rainfall, optionally soil moisture) come from scheduled jobs that pull, validate, aggregate onto the grid and write to `environmental_observations`.
- Each run is recorded in `data_ingestion_runs` with source, time window, row counts, status and provenance.
- **MVP scheduler:** a simple cron-style scheduler. No message queue.
- **Demo mode:** a replay job loads a `SIMULATED_DEMO` rainfall scenario, clearly labelled, so the demo can run on demand.
- 🔶 **REQUIRES HUMAN APPROVAL:** final data sources per layer (see [data-strategy.md](data-strategy.md)), especially any that need registration or have restrictive licences.

### 3.7 Alert service
- A backend module for the MVP.
- **Flow:** risk update → rule evaluation (threshold + optional rising trend) → `DRAFT` alert with explanation → authority approval → `PUBLISHED` → delivery to recipients → acknowledgement tracking.
- **MVP delivery channels:** in-app (web + mobile, fetched via polling or push).
- **Multilingual:** alerts are rendered from human-reviewed templates per language (`alert_templates`), not machine-translated at runtime.
- **Deduplication:** one open alert per location/zone per severity level. Updates attach to the existing alert.
- 🔶 **REQUIRES HUMAN APPROVAL:** mobile push provider, and any SMS provider (post-MVP; costs and regulatory requirements such as sender registration apply).
- 🔶 **REQUIRES HUMAN APPROVAL:** initial language set (proposed: English, Hindi, and one NER language chosen for the pilot area).

### 3.8 Object storage (evidence)
- Stores photo/video evidence. The database keeps only metadata and the storage key.
- The MVP can use local disk behind the backend in development and S3-compatible storage for the demo.
- File limits and allowed MIME types are enforced server-side. EXIF GPS is read if present but not trusted over device GPS.
- 🔶 **REQUIRES HUMAN APPROVAL:** storage provider.

### 3.9 Response priority engine
- A backend module with a transparent, rule-based score for the MVP:
  `priority = f(risk_class, verified_report_severity, exposure(villages/roads nearby), recency)`
- Each priority item lists the reasons behind it. Weights are configurable and documented.
- Future: learned prioritisation, once real response data exists.

## 4. Key data flows

### 4.1 Risk update
1. The ingestion job pulls rainfall for the latest window and aggregates it to grid cells.
2. The batch scoring job calls the ML service for affected cells and stores `risk_assessments` (`MODEL_OUTPUT`, model version).
3. The alert module evaluates thresholds and creates `DRAFT` alerts.
4. The web dashboard fetches the updated risk layer.

### 4.2 Field report (offline-capable)
1. Mobile creates a report with a `client_report_id` and queues it locally.
2. On connectivity, it calls `POST /api/v1/field-reports`. A duplicate `client_report_id` returns the existing report.
3. Media uploads follow and link to the report.
4. The backend links the report to the nearest risk zone/alert and to an incident, then recalculates priority.

## 5. Cross-cutting concerns

| Concern | Approach |
|---|---|
| Provenance | `provenance` enum column + `source_id` on data tables. API responses include `provenance` and `as_of`. |
| Security | HTTPS only, hashed passwords or an external identity provider, RBAC on every endpoint, signed media URLs, input validation, rate limiting on auth |
| Privacy | Minimal personal data. Phone numbers stored only if needed for alerts, and access-restricted. |
| Auditability | `audit_log` for alert approvals, report verification, threshold changes |
| Observability | Structured logs, health endpoints, ingestion-run status visible in admin |
| Configuration | Environment variables, and `.env.example` committed |
| Time | Stored in UTC, displayed in IST (Asia/Kolkata) |
| Localization | UI strings and alert templates in resource files per language |

## 6. Deployment (proposed)

- **Development:** a container setup running Postgres/PostGIS, the backend, the ML service and the web app locally.
- **Demo:** one cloud VM or a simple managed platform. Mobile distributed as an APK for the demo device.
- 🔶 **REQUIRES HUMAN APPROVAL:** cloud provider, budget, domain, and whether containers are used.

## 7. Scaling path (not for MVP)

- Split the alert service into its own deployable with a message queue once external channels (SMS/push) are added.
- Vector tiles served from PostGIS or pre-generated, for full NER coverage.
- Caching of risk layers, and a read replica for dashboards.
- Object storage + CDN for media.
- Stream ingestion for sensors (IoT) in the future.

## 8. Decisions requiring human approval (summary)

| ID | Decision | Options | Recommendation |
|---|---|---|---|
| H1 | Backend language/framework | Python/FastAPI · Node/TypeScript | Python/FastAPI (one language shared with ML) |
| H2 | Web framework + map library | React/TS or Vue/TS · MapLibre or Leaflet | Team skill decides |
| H3 | Mobile framework | React Native/Expo · Flutter · Native Android | Team skill decides. Must support offline storage + background sync |
| H4 | Pilot geography | One NER district/area | Choose an area with a documented landslide inventory and good data coverage |
| H5 | Basemap tile source | Provider free tier · self-hosted | Decide after checking terms |
| H6 | Hosting/cloud | Any | Cheapest reliable option. Avoid lock-in. |
| H7 | Evidence storage | Local disk · S3-compatible | S3-compatible for the demo |
| H8 | Push/SMS providers | — | In-app only for the MVP |
| H9 | Initial languages | — | English + Hindi + one pilot-area language |
| H10 | Final data sources per layer | See data-strategy.md | After licence review |
| H11 | Risk class thresholds | — | Set by the ML engineer from validation, then reviewed by the team |
| H12 | Project licence | — | — |
