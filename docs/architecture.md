# Architecture — GeoRakshak

> **Status:** **APPROVED MVP architecture, not implemented.** Nothing here exists as code or infrastructure yet.
> **Revision:** aligned with the official SIH26001 requirements (OR-01 to OR-21, see [problem-statement.md](problem-statement.md) and [product-spec.md §2](product-spec.md)). Approved: single Python backend deployable, imported ML package, adapter and status-registry design, tiered alert policy, SMS sandbox default, single-region cloud + laptop fallback. Decision status in §9.
> Items still marked **🔶 REQUIRES HUMAN APPROVAL** (H10, H11, H12, media retention, Google Earth Engine dependency) must not be built until a team member approves them and updates this file.
> Contracts: HTTP API and internal interfaces in [api.md](api.md). Schema in [database.md](database.md).

## 1. Goals and constraints

| Goal / constraint | Architectural response | Official reqs |
|---|---|---|
| Reliable prototype within hackathon time | Few deployables. One backend deployable with modules. Precomputed scores. | — |
| Multi-source environmental data | **Adapter layer** with provider-independent interfaces for weather, sensors and satellite. Connection status is recorded for each adapter. | OR-01, 02, 03, 17, 18, 19 |
| Real-time monitoring and alerts | Scheduler-driven ingestion → rescoring → alert rules on every update. Channels dispatch as soon as an alert is ready. | OR-07 |
| Forecasts | The same scorer runs on forecast inputs, and outputs are stored per lead time | OR-13 |
| Explainable AI | The scorer always returns factor contributions | OR-06 |
| Roads, villages, infrastructure, connectivity | PostGIS exposure layers and a road-segment status module | OR-09, OR-12 |
| Automated SMS/app warnings | Notification service with pluggable channels and a tiered automation policy | OR-20, OR-15 |
| Intermittent connectivity | Offline-first mobile, duplicate-safe sync, SMS for phones without data | OR-16, OR-21 |
| Cloud-based | Containerised deployment to one cloud region, with managed or containerised Postgres and object storage | OR-21 |
| Data honesty | Provenance on every record, and a data-source status registry shown in the UI | All |
| Scale later | Versioned API, adapter interfaces, stateless services, and a documented split path (§8) | — |

## 2. System overview

```
                 ┌──────────────────────── OFFLINE PIPELINE (ML engineer, scripts) ─────────────────────────┐
                 │ DEM → terrain │ inventory → labels │ Sentinel-2/WorldCover → satellite features │ OSM → exposure │
                 │ build grid → features → train + validate model → model file + model card → load into DB     │
                 └───────────────────────────────────────────────┬────────────────────────────────────────────┘
                                                                 │ load scripts
┌───────────────── EXTERNAL / EDGE ─────────────────┐            ▼
│ Weather: IMD gridded files (real, historical)     │   ┌───────────────────────── CLOUD (single region) ─────────────────────────┐
│          IMD API (AWAITING_ACCESS)                │   │  ┌──────────────────── Backend deployable (Python) ──────────────────┐  │
│          forecast provider (H16)│ replay (demo)    │──►│  │ ADAPTERS     weather · sensor · satellite  → status registry       │  │
│ Satellite feed: IMERG (INTEGRATION-READY)         │──►│  │ SCHEDULER    ingest → features → score (current + forecast)        │  │
│ Sensors: virtual stations (SIMULATED) ──POST──────│──►│  │ ML PACKAGE   georakshak_ml: score() · active_model()               │  │
│          future gateways (LoRa/MQTT bridge)       │   │  │ DOMAIN       risk · exposure · road status · reports · priority    │  │
└───────────────────────────────────────────────────┘   │  │ NOTIFY       alert rules · tier policy · templates · channels:     │  │
                                                        │  │              app(push/poll) · SMS(sandbox | gateway H14)           │  │
┌──────────────┐  HTTPS/GeoJSON                         │  │ API          /api/v1 (REST) · auth/RBAC                            │  │
│ Web dashboard│◄──────────────────────────────────────►│  └───────────────┬───────────────────────────────┬───────────────────┘  │
└──────────────┘                                        │                  ▼                               ▼                      │
┌──────────────┐  HTTPS + media (offline queue)         │     ┌──────────────────────┐        ┌──────────────────────┐          │
│ Mobile app   │◄──────────────────────────────────────►│     │ PostgreSQL + PostGIS │        │ Object storage       │          │
│ field/citizen│◄─ push (FCM)─┐                          │     └──────────────────────┘        │ (photo/video)        │          │
└──────────────┘              │                          └──────────────────────────────────────┴──────────────────────┴──────────┘
┌──────────────┐              │ SMS gateway (H14: only after DLT compliance + cost cleared) or SANDBOX log
│ Basic phone  │◄─ SMS ───────┘
└──────────────┘
```

## 3. Components

### 3.1 Web dashboard (authorities)
- **Screens:** risk map with layer toggles (current risk, **forecast +24/48/72 h**, historical landslides, villages/facilities, **road status**, **sensor stations**, **satellite layers**, reports); cell detail with explanations; **data-source status panel**; mode banner (LIVE / DEMO REPLAY); alert drafts and approval; dispatch log per channel and language; report moderation and verification with photo/video player; priority list.
- **Refresh:** polling (5–10 s) for the MVP.
- Framework and map library (H2, approved: React/TS or Vue/TS with MapLibre or Leaflet, chosen by the Frontend owner's skill and recorded in Phase 0). Basemap tile source (H5, approved: chosen after a terms-of-use check).

### 3.2 Mobile app (field officer + citizen modes)
- **Field mode:** internal alerts and tasks inbox, report form, road status report, sync status.
- **Citizen mode:** public warnings inbox, simplified observation report.
- **Offline-first:**
  - Every report is written to on-device storage first, with a device-generated `client_report_id`.
  - Sync worker: report data first, then media (photo ≤10 MB, video ≤30 s compressed), with retry and backoff.
  - Duplicate-safe server endpoints.
  - Last-known risk for the user's area and received alerts are cached for offline viewing.
- **Alert receipt:** push notification via FCM (H8, approved) with inbox polling as fallback.
- Framework (H3, approved: React Native/Expo, Flutter or native Android, chosen by the Mobile owner's skill and recorded in Phase 0). Must support local DB, background sync, camera/video and push. Android-first.
- **As implemented (Expo SDK 57):**
  - Sync runs on connectivity return, on foreground, on a 30 s interval while the app is open and on demand. There is **no OS background sync in Expo Go**, so an app that is closed syncs when it is next opened.
  - No video transcoding yet: recording is capped at 29 s and a file over the frozen limits is rejected with a message, rather than compressed.
  - Media stays on the device after upload until the retention period (A14) is decided.
  - Push is a disabled placeholder that reports `NOT_CONNECTED`; the inbox polls every 15 s (H8).

### 3.3 Backend deployable
A single **Python + FastAPI** service (H1, approved) with these modules:

| Module | Responsibility |
|---|---|
| `auth` | Users, roles (`ADMIN`, `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `FIELD_OFFICER`, `CITIZEN`), tokens |
| `adapters.weather` | `WeatherProvider` interface: `observed(area, window)`, `forecast(area, horizons)`. Adapters listed in §4. |
| `adapters.sensor` | Sensor ingestion API + station registry + validation (units, ranges, timestamps, duplicates) |
| `adapters.satellite` | `SatelliteSource` interface: static-layer registry (real, precomputed) and feed slot (IMERG) |
| `sources` | **Data-source status registry**: connection status, last success, provenance, licence, for every adapter and channel |
| `scheduler` | Periodic jobs: ingest → aggregate to cells → score current + forecast → road status → alert rules |
| `risk` | Calls `georakshak_ml`, persists assessments and factors, serves risk layers |
| `exposure` | Villages, facilities, road segments. Exposure per cell. |
| `roads` | Road-segment status from risk and verified reports. Village "access at risk" flag. |
| `reports` | Field and citizen reports, media, moderation, verification, duplicate-safe sync |
| `notify` | Alert rules, **tier policy** (§3.6), template rendering per language, channel dispatch, delivery log |
| `priority` | Transparent response-priority rules with reasons |
| `demo` | Replay mode, virtual-sensor emulator control, reset. **Disabled in live mode.** |

### 3.4 ML package (`georakshak_ml`) and offline pipeline
- **Offline pipeline** (ML-owned scripts): data preparation, grid and features, training, spatial validation, model file export, model card.
- **Package** (imported by the backend): `score(features) → {score, severity, confidence, factors[]}` for current and forecast feature sets.
- Keeping the package boundary lets it become a separate service later without changing callers.
- **H13 (approved):** this replaces the earlier separate ML HTTP service proposal for the MVP.
- See [ml-strategy.md](ml-strategy.md).

### 3.5 PostgreSQL + PostGIS
- The system of record. EPSG:4326 storage, spatial indexes on geometry columns.
- MVP tables (see [database.md](database.md)):
  - core: `users`, `admin_boundaries`, `data_sources` (also the **status registry**), `model_versions`, `risk_zones`, `risk_assessments` (current and forecast via `lead_time_h`)
  - environmental: `rainfall_observations`, `rainfall_forecasts`, `sensor_stations`, `sensor_readings`, `historical_landslides`
  - exposure: `locations` (villages and facilities, with access status), `road_segments` (with status)
  - operations: `reports` (field and citizen), `evidence`, `alerts`, `notification_deliveries`, `audit_events`
  - devices: `user_devices` (FCM push tokens, H8)
- Hosting (H6, approved approach): cheapest reliable single-region option. Managed Postgres or a container with backups, decided when the provider is recorded.

### 3.6 Notification service (tiered automation)

| Tier | Trigger | Audience | Approval | Channels |
|---|---|---|---|---|
| **Watch** (internal) | Cell reaches High (current or forecast) | Field officers + control room for the area | **Automatic** | App, and SMS if enabled |
| **Warning** (public) | Very High, or High + verified report | Citizens registered in the affected area | **Human approval** | App + SMS |
| **Update / all-clear** | Authority action | Previous recipients | Human | App + SMS |

- **Channels** implement `send(recipient, message) → delivery_status`:
  - `AppChannel`: FCM push notification (H8) plus in-app inbox.
  - `SmsChannel`: **`SANDBOX` mode (default)** renders the exact SMS text per language, records the encoding and segment count a gateway would charge for, and logs `SANDBOXED`. Measured with the current templates: **English 1 GSM-7 segment, Hindi 2 UCS-2 segments** per warning (Indic scripts allow 70 characters per segment), which is the cost input for H14. **`GATEWAY` mode** (H14) may be enabled only after DLT compliance and cost are cleared and documented. It sends to consenting test numbers only.
- **Deduplication and rate limits:** one active alert per zone per tier. Updates attach to it. There is a cooldown per recipient.
- **Templates** are human-reviewed per language: English, Hindi and one pilot-area language (H9, approved; the specific third language follows the H4 pilot selection). No runtime machine translation.
- **H15 (approved):** tier structure and the rule that only `WATCH` may be auto-dispatched. The numeric trigger levels follow the severity thresholds (🔶 H11).

### 3.7 Weather and real-time monitoring
- **LIVE mode:** the scheduler polls the configured live/forecast provider every N minutes (N set by the provider's update frequency and terms). Results are labelled `REAL_LIVE` and freshness is shown.
- **DEMO REPLAY mode:** a deterministic scenario (real historical rainfall period preferred, else simulated) is fed through **the same pipeline**. Mode is shown in a banner.
- **"Real-time" in the MVP means:** alert rules are evaluated on every ingestion cycle, and dispatch is immediate. Data freshness is limited by the source's own latency, which is displayed.

### 3.8 Road connectivity
- Road segments from OSM, split at intersections, stored with `status` and `status_reason`.
- `AT_RISK`: the segment intersects a High or Very High cell (current or chosen forecast horizon).
- `BLOCKED`: a verified report of category `ROAD_BLOCKED` or `LANDSLIDE` within a set distance (snapped to the nearest segment). An authority can reopen it.
- Village "access at risk": all road segments within X m of the village are `BLOCKED` or `AT_RISK`. This is a simple rule, **not** a network reachability analysis.
- Post-MVP: routing (for example pgRouting) for true reachability and alternate routes.

### 3.9 Object storage
- Photo and video in a cloud bucket (demo) or a disk volume (development). The database stores metadata, key and hash.
- Server-side MIME, size and duration validation. EXIF GPS is recorded but device GPS is authoritative.
- Provider (H7, approved): cloud bucket for the demo, disk volume in development.

## 4. Adapter and integration status (the honesty contract)

Every adapter and channel registers in `data_sources` (`connection_status` column, exposed by `GET /api/v1/data-sources`) and is shown on the dashboard.

| Adapter | Requirement | MVP implementation | Status shown | Promotion condition |
|---|---|---|---|---|
| IMD gridded rainfall (files) | OR-01, OR-17 | Real historical load | `CONNECTED_HISTORICAL` | — |
| IMD weather API | OR-17 | Interface slot only. No invented request/response format. | `AWAITING_ACCESS` | IMD grants access → implement against IMD's documentation → `CONNECTED_LIVE` |
| Forecast provider | OR-13 | IMD API if access is granted, else an approved provider labelled non-IMD (H16), or the replay scenario forecast | `CONNECTED_LIVE` or `SIMULATED` | — |
| Replay scenario | Demo | Real historical period, or simulated | `CONNECTED_HISTORICAL` / `SIMULATED` | — |
| Virtual soil moisture stations | OR-02 | Emulator posting through the real sensor API | `SIMULATED` | Physical node or partner gateway posts real readings → `CONNECTED_LIVE` |
| Generic sensor gateway | OR-19 | Documented ingestion contract + tests | `NOT_CONNECTED` | Any real device/gateway connected |
| Satellite static layers | OR-03 | Real precomputed Sentinel-2 / WorldCover | `CONNECTED_HISTORICAL` (with acquisition date) | — |
| Satellite feed (IMERG) | OR-18 | Interface slot + scheduled job skeleton | `NOT_CONNECTED` | Phase 0/3 spike succeeds → `CONNECTED_LIVE` (moves to class 2) |
| App push channel | OR-20 | Push + inbox | `CONNECTED_LIVE` once FCM is really delivering (inbox polling is the fallback) | — |
| SMS channel | OR-20 | Sandbox rendering and log | `SANDBOX` | Gateway approved and compliant → `CONNECTED_LIVE` (test numbers) |

**Rules:**
- A class 3 item is never demonstrated with fabricated data from that source.
- Adapter tests use **our own normalised format** and fixtures. We don't make up a third-party response format we haven't seen.

## 5. Key data flows

### 5.1 Monitoring cycle (every N minutes, or every replay step)
1. Weather adapter → observed and forecast rainfall per cell.
2. Sensor readings received since the last cycle → nearest cells (within the station's influence radius, documented).
3. Features assembled from static (terrain, satellite, history) and dynamic (rainfall, soil moisture) inputs.
4. `georakshak_ml.score()` → current risk + forecast risk (+24/48/72 h) with factors → stored as `MODEL_OUTPUT`.
5. Road-segment status and village access flags updated.
6. Alert rules and tier policy → watch alerts auto-dispatched, public warning drafts created.
7. Dashboard polling picks up the changes.

### 5.2 Report (offline-capable)
1. The device stores the report and media locally.
2. On connectivity: `POST /api/v1/reports` (duplicate-safe via `client_report_id`) → `POST /api/v1/reports/{id}/media`.
3. Backend links the report to its cell, nearest road segment and exposure.
4. Citizen reports → moderation queue.
5. Verification → road status update → priority recalculation.

### 5.3 Public warning
Draft → authority edits, selects languages → approve → recipients resolved spatially (citizens registered in the area) → channels dispatch → delivery log → app acknowledgements.

## 6. Cross-cutting concerns

| Concern | Approach |
|---|---|
| Provenance | `provenance` on every data row. `data_sources.connection_status` for every adapter and channel. Both returned by the API and shown in the UI. |
| Security | HTTPS, RBAC on every endpoint, a sensor ingestion API key per station, signed media URLs, upload validation, auth rate limits |
| Privacy | Citizen phone numbers only with consent, access-restricted, and never in logs or exports. Demo uses team numbers or fictional ones. |
| Regulatory | Commercial SMS in India requires DLT registration of sender/templates (TRAI regime), so SMS stays in sandbox unless compliance is handled. GeoRakshak does not issue official warnings. |
| Auditability | Approvals, auto-dispatches, verifications, road reopenings logged with actor and time |
| Time | UTC stored, IST displayed. Forecasts store issue time and valid time. |
| Localisation | Notification templates per language. UI strings in resource files. |
| Map depiction | Views are limited to the pilot area, with no national boundaries from non-official datasets |

## 7. Deployment

- **Development:** containers locally (Postgres/PostGIS, backend, web).
- **Cloud (demo, OR-21):** one region, one VM or container platform. Backend and web as containers. Postgres (managed or container with backups). Object storage bucket. HTTPS domain. The scheduler runs inside the backend deployable.
- **Venue fallback:** the same containers on a laptop, with the phone on the laptop hotspot.
- **Mobile:** APK sideloaded on demo devices.
- Cloud provider (H6, approved approach: cheapest reliable single region). Provider, budget and domain are recorded by the Backend owner in Phase 0.

## 8. Scaling path (post-MVP, shown on the architecture slide)

1. Separate the ML package into a scoring service. Separate the notification service with a message queue for SMS and push.
2. Sensor gateway bridge (for example MQTT/LoRaWAN → HTTP ingestion) and time-series partitioning for `sensor_readings`.
3. Live satellite feeds (IMERG, Sentinel-2/Sentinel-1) as scheduled workers with object-store rasters.
4. Vector tiles and caching for full-NER coverage. Read replicas.
5. High availability across zones, CDN for media, autoscaling.
6. Routing engine for road network reachability.

## 9. Decisions

Approved by the project lead on 2026-09-17 unless marked 🔶. "Owner records" means the approved rule is applied by the named owner in Phase 0, and the concrete choice is written into this table. It does not need a new approval unless it breaks the rule.

| ID | Decision | Approved outcome | Status | Concrete choice (recorded in Phase 0) |
|---|---|---|---|---|
| H1 | Backend language/framework | **Python + FastAPI** | **APPROVED** | FastAPI |
| H2 | Web framework + map library | React/TS or Vue/TS, with MapLibre or Leaflet, chosen by the Frontend owner's skill | **APPROVED** | React + TypeScript + Vite + MapLibre GL JS |
| H3 | Mobile framework | React Native/Expo, Flutter or native Android, chosen by the Mobile owner's skill. Must support local DB, background sync, camera/video, push. | **APPROVED** | Expo (React Native) + TypeScript |
| H4 | Pilot geography | One NER district or corridor, chosen by landslide inventory count and data coverage | **APPROVED** criterion (ML + PC record after data spike) | Data spike (2026-09-17) recommends **Aizawl, Mizoram — PROVISIONAL**, Kohima as the alternate ([data-spike.md](../ml/reports/data-spike.md)). Awaiting team sign-off. |
| H5 | Basemap tile source | Provider tier or self-hosted, chosen after a terms-of-use check | **APPROVED** | None by default (own GeoJSON layers). A provider is added only after a terms check. |
| H6 | Cloud provider / hosting | Cheapest reliable single-region option + laptop fallback | **APPROVED** (BE records) | TBD by BE |
| H7 | Object storage | Cloud bucket for the demo, disk volume in development | **APPROVED** | Bucket provider follows H6 |
| H8 | Push notification provider | FCM, with inbox polling fallback | **APPROVED** | FCM |
| H9 | Notification languages | English + Hindi + one pilot-area language | **APPROVED** | Third language follows H4 |
| H10 | Final data sources per layer | After Phase 0 verification and licence review | 🔶 PENDING (Phase 0) | — |
| H11 | Severity thresholds | From validation, team-reviewed | 🔶 PENDING (Phase 3) | Current cut-offs (0.25 / 0.45 / 0.65) are the B0 model card's uncalibrated heuristics. Adopting any trained Stage A model additionally requires passing the recorded gate in [ml-strategy.md §7a](ml-strategy.md); as of 2026-09-18, with GSI surveyed labels, none does: the binding criterion is the share of area flagged, because the pilot is uniformly steep. Pilot `feature_version` is now `pilot-features-0.2.0` (`past_landslide_density` recomputed from the surveyed inventory). |
| H12 | Project licence | — | 🔶 PENDING | — |
| H13 | ML as imported package (replaces the earlier separate ML service) | `georakshak_ml` package imported by the backend | **APPROVED** | — |
| H14 | SMS mode | Sandbox by default. Gateway only after DLT compliance and cost are cleared and documented, to consenting test numbers only. | **APPROVED** | Sandbox (gateway gated). Cost basis now measured per delivery: English 1 segment, Hindi 2 segments. |
| H15 | Warning automation tier policy | Automatic internal `WATCH`, human-approved public `WARNING` (§3.6) | **APPROVED** | — |
| H16 | Forecast provider for live mode | IMD API if access is granted, else an approved provider clearly labelled non-IMD, else replay only | **APPROVED** rule (ML + BE record the non-IMD provider after a terms check) | TBD |
| H17 | Physical sensor prototype node | None by default | **APPROVED** | None |
| H18 | Citizen registration in MVP | Demo accounts only | **APPROVED** | Demo accounts |

Other open items (🔶): evidence media retention period ([database.md §7](database.md)), any dependency on Google Earth Engine ([data-strategy.md §7](data-strategy.md)), and extra ML libraries beyond the approved set ([ml-strategy.md §5](ml-strategy.md)).
