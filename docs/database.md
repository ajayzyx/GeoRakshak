# Database Design (Conceptual) — GeoRakshak

> **Status:** CONCEPTUAL, **APPROVED MVP scope**, matching the frozen API contract v1 (aligned with official SIH26001 OR-01 to OR-21). No database, migration or DDL exists yet.
> Target: PostgreSQL + PostGIS inside the approved single-backend architecture ([architecture.md](architecture.md)). Owner: Backend Developer.
> Scope tags: **[MVP]** built for the prototype · **[EXTENSION]** post-MVP.

## 1. Conventions

| Convention | Rule |
|---|---|
| Primary keys | `id UUID` (high-volume time series may use `bigint` identity) |
| Timestamps | `timestamptz`, stored in UTC. `created_at` / `updated_at` on mutable tables. |
| Geometry SRID | **EPSG:4326** for all stored geometry. Projected CRSs used only in computation. |
| Geometry types | Explicit type per column, for example `geometry(Point, 4326)` |
| Spatial indexes | GiST index on every geometry column |
| Provenance | `provenance` on every environmental, risk, event and report row: `REAL_LIVE`, `REAL_HISTORICAL`, `SIMULATED_DEMO`, `MODEL_OUTPUT` |
| Connection status | On `data_sources`: `CONNECTED_LIVE`, `CONNECTED_HISTORICAL`, `SIMULATED`, `SANDBOX`, `AWAITING_ACCESS`, `NOT_CONNECTED` |
| Soft delete | `deleted_at` on user-generated content (reports, evidence) |
| Naming | `snake_case`, plural table names |
| Enums | Postgres enums or check constraints (decided at implementation) |

## 2. Entity overview

| Table | Scope | Official reqs |
|---|---|---|
| `users` | [MVP] | OR-10, OR-15, OR-20 |
| `user_devices` | [MVP] (FCM push tokens, H8) | OR-20 |
| `admin_boundaries` | [MVP] | OR-08 |
| `data_sources` | [MVP] | OR-17, OR-18, OR-19, OR-20 (status registry) |
| `model_versions` | [MVP] | OR-06 |
| `risk_zones` | [MVP] | OR-06, OR-08, OR-11 |
| `rainfall_observations` | [MVP] | OR-01 |
| `rainfall_forecasts` | [MVP] | OR-13 |
| `sensor_stations` | [MVP] | OR-02, OR-19 |
| `sensor_readings` | [MVP] | OR-02, OR-19 |
| `historical_landslides` | [MVP] | OR-05 |
| `risk_assessments` | [MVP] | OR-06, OR-11, OR-13 |
| `locations` | [MVP] | OR-09 |
| `road_segments` | [MVP] | OR-09, OR-12 |
| `reports` | [MVP] | OR-10, OR-16 |
| `evidence` | [MVP] | OR-10 |
| `alerts` | [MVP] | OR-07, OR-15, OR-20 |
| `notification_deliveries` | [MVP] | OR-15, OR-20 |
| `audit_events` | [MVP] (minimal) | Accountability |
| `organizations`, `incidents`, `alert_templates`, `response_priority_snapshots`, `data_ingestion_runs`, `road_graph_*`, `sms_opt_outs` | [EXTENSION] | See §5 |

## 3. Relationships

```
admin_boundaries (parent_id → self: state → district → block)
  ├─1:*─ users (jurisdiction or registered area)
  ├─1:*─ risk_zones
  ├─1:*─ locations
  └─1:*─ alerts

data_sources ─1:*─ rainfall_observations | rainfall_forecasts | sensor_stations | historical_landslides | locations | road_segments
sensor_stations ─1:*─ sensor_readings

risk_zones ─1:*─ rainfall_observations
risk_zones ─1:*─ rainfall_forecasts
risk_zones ─1:*─ risk_assessments ─*:1─ model_versions
risk_zones ─*:*─ road_segments       (spatial, computed; no join table in MVP)
risk_zones ─*:*─ locations           (spatial, computed)
sensor_stations ─*:*─ risk_zones     (within influence radius, computed)

users ─1:*─ reports ─1:*─ evidence
reports ─*:1─ risk_zones, road_segments (nearest), alerts (optional)
road_segments.status_report_id ─*:1─ reports

alerts ─*:1─ risk_assessments (triggering)
alerts ─1:*─ notification_deliveries ─*:1─ users
users ─1:*─ user_devices

audit_events (entity_type + entity_id, actor → users)
```

## 4. MVP tables

### 4.1 `users` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| full_name | text | Fictional for demo accounts |
| email | text unique, nullable | |
| phone | text, nullable | **Only with consent**, access-restricted, never logged in full |
| phone_consent_at | timestamptz, nullable | Required if `phone` is set |
| password_hash | text | |
| role | enum | `ADMIN`, `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `FIELD_OFFICER`, `CITIZEN` |
| admin_boundary_id | uuid FK → admin_boundaries | Jurisdiction (authorities, officers) or registered area (citizens) |
| registered_location | geometry(Point, 4326), nullable | Citizens only, with consent. Used to target public warnings. |
| preferred_language | text | BCP 47, for example `en`, `hi`, pilot-area language code |
| sms_enabled | boolean | |
| is_active | boolean | |
| is_demo_account | boolean | |
| created_at / updated_at | timestamptz | |

### 4.2 `user_devices` [MVP] — FCM push tokens (H8)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | |
| platform | enum | `ANDROID`, `IOS` |
| push_token | text | Secret. Never logged. |
| app_version | text | |
| last_seen_at | timestamptz | |

### 4.3 `admin_boundaries` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| level | enum | `STATE`, `DISTRICT`, `SUBDISTRICT`, `BLOCK`, `VILLAGE` |
| name | text | |
| lgd_code | text, nullable | Local Government Directory code |
| parent_id | uuid FK → admin_boundaries | |
| geom | geometry(MultiPolygon, 4326) | |
| source_id | uuid FK → data_sources | |

### 4.4 `data_sources` [MVP] — dataset registry and **integration status registry**
Covers datasets, live adapters **and** notification channels. Exposed by `GET /data-sources`.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| slug | text unique | For example `imd-gridded-rainfall`, `imd-weather-api`, `imerg-feed`, `virtual-soil-moisture`, `sensor-gateway`, `sentinel2-composite`, `sms-channel`, `app-push-channel` |
| kind | enum | `WEATHER_HISTORICAL`, `WEATHER_LIVE`, `WEATHER_FORECAST`, `SENSOR`, `SATELLITE_LAYER`, `SATELLITE_FEED`, `TERRAIN`, `INVENTORY`, `EXPOSURE`, `BOUNDARY`, `NOTIFICATION_CHANNEL`. 🔶 There is no soil category yet: add `SOIL` (or widen `TERRAIN`) before soil-property features (S31, S32) ever enter a pilot handoff. |
| provider | text | |
| dataset | text | Product name + version |
| connection_status | enum | See §1 |
| status_note | text | For example "IMD API access requested on <date>, ref <id>" |
| access_requested_at | timestamptz, nullable | |
| last_success_at | timestamptz, nullable | |
| last_error | text, nullable | |
| verification_status | enum | `UNVERIFIED`, `VERIFIED`, `REJECTED` (from [data-strategy.md](data-strategy.md)) |
| verified_at | date, nullable | |
| licence | text | |
| attribution_text | text | Shown in the UI where the data appears |
| provenance_default | enum | |
| metadata | jsonb | For example satellite layer acquisition date range, storage path, resolution. Forecast provider label (IMD / non-IMD). |

**Rule:** `connection_status` may be set to `CONNECTED_LIVE` only by a successful real call to a real source, never by seed data.

### 4.5 `model_versions` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| version | text unique | For example `b0-rules-0.1.0`, `susc-gbm-0.1.0` |
| model_type | enum | `RULES_B0`, `LOGREG`, `TREE_ENSEMBLE` |
| stage | enum | `SUSCEPTIBILITY`, `TRIGGER`, `COMBINED` |
| git_commit | text | |
| data_version | text | Hash of the training data snapshot |
| feature_config | jsonb | |
| thresholds | jsonb | Severity boundaries + rationale |
| sensor_modifier_config | jsonb, nullable | Bounded rule parameters ([ml-strategy.md §2.4](ml-strategy.md)) |
| validation_scheme | text | For example "spatial block CV, k=5" |
| metrics | jsonb, nullable | **Null until really evaluated.** Never populated from simulated data. |
| forecast_skill_evaluated | boolean | Default false |
| model_card_uri | text | |
| is_active | boolean | |

### 4.6 `risk_zones` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| grid_code | text unique | Stable cell ID |
| geom | geometry(Polygon, 4326) | 250–500 m cell |
| centroid | geometry(Point, 4326) | |
| admin_boundary_id | uuid FK → admin_boundaries | |
| static_features | jsonb | Terrain (slope, relief, curvature), satellite (land cover, vegetation index), history, exposure counts |
| static_feature_version | text | |
| current_severity | enum, nullable | Stored copy of the latest current assessment: `LOW`, `MODERATE`, `HIGH`, `VERY_HIGH` |
| current_assessment_id | uuid FK → risk_assessments, nullable | |

### 4.7 `rainfall_observations` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| risk_zone_id | uuid FK → risk_zones | |
| period_start / period_end | timestamptz | |
| rainfall_mm | double precision | |
| source_id | uuid FK → data_sources | |
| provenance | enum | `REAL_HISTORICAL`, `REAL_LIVE` or `SIMULATED_DEMO` (replay fallback) |
| quality_flag | text, nullable | |

Unique: `(risk_zone_id, period_start, period_end, source_id)`. Aggregates (3/7/15/30-day totals, anomaly) are computed in the scoring step, not stored separately in the MVP.

### 4.8 `rainfall_forecasts` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| risk_zone_id | uuid FK → risk_zones | |
| issue_time | timestamptz | When the forecast was issued |
| valid_start / valid_end | timestamptz | |
| lead_time_h | smallint | 24, 48, 72 |
| rainfall_mm | double precision | |
| source_id | uuid FK → data_sources | Metadata states IMD / non-IMD / replay |
| provenance | enum | `REAL_LIVE` or `SIMULATED_DEMO` |

**Rule:** forecasts are never stored in `rainfall_observations`.

### 4.9 `sensor_stations` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| station_code | text unique | |
| name | text | |
| station_type | enum | `VIRTUAL`, `PHYSICAL` |
| geom | geometry(Point, 4326) | |
| variables | text[] | MVP: `SOIL_MOISTURE_VWC` |
| depth_cm | real, nullable | |
| influence_radius_m | real | Documented assumption used by the adjustment rule |
| api_key_hash | text | Per-station ingestion key (hash only) |
| status | enum | `ACTIVE`, `INACTIVE` |
| source_id | uuid FK → data_sources | |
| provenance | enum | `VIRTUAL` stations are always `SIMULATED_DEMO` |
| last_reading_at | timestamptz, nullable | |

### 4.10 `sensor_readings` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| station_id | uuid FK → sensor_stations | |
| variable | text | `SOIL_MOISTURE_VWC` |
| value | double precision | |
| unit | text | `m3/m3` |
| observed_at | timestamptz | Device time |
| received_at | timestamptz | Server time |
| quality_flag | enum | `OK`, `SUSPECT`, `OUT_OF_RANGE` |
| provenance | enum | Copied from the station |

Unique: `(station_id, variable, observed_at)`, which makes retries safe.
[EXTENSION]: time partitioning, retention policy, more variables (rain gauge, piezometer, tilt).

### 4.11 `historical_landslides` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| geom | geometry(Geometry, 4326) | Point or polygon as provided |
| event_date | date, nullable | |
| event_date_precision | enum | `EXACT`, `MONTH`, `YEAR`, `UNKNOWN` |
| location_accuracy_m | real, nullable | |
| trigger | text, nullable | As given in the source |
| landslide_type | text, nullable | As given in the source |
| fatalities | integer, nullable | Only if in the source. Never estimated. |
| source_id | uuid FK → data_sources | |
| source_record_id | text | |
| provenance | enum | `REAL_HISTORICAL` |
| used_in_training | boolean | |

### 4.12 `risk_assessments` [MVP] — current and forecast risk
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| risk_zone_id | uuid FK → risk_zones | |
| model_version_id | uuid FK → model_versions | |
| lead_time_h | smallint | `0` = current, `24`/`48`/`72` = forecast |
| issue_time | timestamptz | Scoring time (current) or forecast issue time |
| valid_from / valid_until | timestamptz | |
| score | real | 0–1 |
| severity | enum | `LOW`, `MODERATE`, `HIGH`, `VERY_HIGH` |
| confidence | enum | `LOW`, `MEDIUM`, `HIGH` (decreases with lead time) |
| factors | jsonb | Explanation list ([api.md §6.2](api.md)), each factor with its provenance |
| input_provenance | text[] | For example `{REAL_HISTORICAL, SIMULATED_DEMO}` |
| forecast_source_id | uuid FK → data_sources, nullable | Set when `lead_time_h > 0` |
| run_mode | enum | `LIVE`, `DEMO_REPLAY` |
| is_latest | boolean | Latest per `(risk_zone_id, lead_time_h, run_mode)` |
| provenance | enum | `MODEL_OUTPUT` |

### 4.13 `locations` [MVP] — villages and infrastructure
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | enum | `VILLAGE`, `TOWN`, `SCHOOL`, `HEALTH_FACILITY`, `BRIDGE`, `SHELTER`, `OTHER` |
| name | text, nullable | |
| geom | geometry(Geometry, 4326) | |
| admin_boundary_id | uuid FK → admin_boundaries | |
| population | integer, nullable | With `population_source_year`. Omitted rather than guessed. |
| population_source_year | smallint, nullable | |
| access_status | enum | Villages/towns: `OK`, `ACCESS_AT_RISK`, `UNKNOWN` |
| access_status_reason | text, nullable | |
| access_status_updated_at | timestamptz, nullable | |
| osm_id | text, nullable | |
| attributes | jsonb | |
| source_id | uuid FK → data_sources | |
| provenance | enum | `REAL_HISTORICAL` |

### 4.14 `road_segments` [MVP] — roads and connectivity status
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| osm_way_id | text | |
| name | text, nullable | |
| road_class | text | From OSM |
| geom | geometry(LineString, 4326) | Split at intersections |
| status | enum | `OPEN` (no evidence of blockage), `AT_RISK`, `BLOCKED`, `UNKNOWN` |
| status_source | enum | `MODEL_RISK`, `VERIFIED_REPORT`, `AUTHORITY_OVERRIDE`, `NONE` |
| status_reason | text | |
| status_lead_time_h | smallint, nullable | For `AT_RISK` from forecast risk |
| status_report_id | uuid FK → reports, nullable | |
| status_updated_by | uuid FK → users, nullable | |
| status_updated_at | timestamptz | |
| source_id | uuid FK → data_sources | |
| provenance | enum | Geometry `REAL_HISTORICAL`. Status is our output. |

**Precedence:** `AUTHORITY_OVERRIDE` > `VERIFIED_REPORT` (`BLOCKED`) > `MODEL_RISK` (`AT_RISK`) > `OPEN`/`UNKNOWN`.
[EXTENSION]: `road_graph_*` tables for route calculation.

### 4.15 `reports` [MVP] — field and citizen reports
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| client_report_id | uuid **unique** | Device-generated **idempotency key** for offline sync |
| reporter_id | uuid FK → users | |
| reporter_role | enum | `FIELD_OFFICER`, `CITIZEN` (copied from the user at submit time) |
| alert_id | uuid FK → alerts, nullable | |
| category | enum | `LANDSLIDE`, `CRACK`, `SEEPAGE`, `ROCKFALL`, `ROAD_BLOCKED`, `SUBSIDENCE`, `OTHER` |
| severity | enum | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| description | text | |
| language | text | BCP 47 |
| geom | geometry(Point, 4326) | Device GPS |
| gps_accuracy_m | real | |
| location_adjusted_manually | boolean | Disclosed pin adjustment |
| captured_at | timestamptz | Device time (may be offline) |
| submitted_at | timestamptz | Server receipt |
| risk_zone_id | uuid FK → risk_zones, nullable | |
| road_segment_id | uuid FK → road_segments, nullable | Nearest segment within a set distance |
| media_expected | smallint | |
| verification_status | enum | `UNVERIFIED`, `VERIFIED`, `REJECTED` |
| verified_by / verified_at / verification_note | | |
| device_info | jsonb | App version, platform |
| provenance | enum | |
| deleted_at | timestamptz, nullable | |

**Rule:** only `VERIFIED` reports affect road status or priority. Citizen reports always start `UNVERIFIED`.

### 4.16 `evidence` [MVP] — photo/video media
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| report_id | uuid FK → reports | |
| client_media_id | uuid unique | Idempotency for media upload |
| media_type | enum | `PHOTO`, `VIDEO` |
| mime_type | text | Validated server-side |
| storage_key | text | Object storage key. Files never go in the database. |
| size_bytes | bigint | |
| sha256 | text | |
| duration_s | real, nullable | Video ≤30 s (frozen, api.md §5.7; the server rejects longer clips) |
| geom | geometry(Point, 4326), nullable | EXIF/device, if available |
| captured_at | timestamptz, nullable | |
| upload_status | enum | `PENDING`, `UPLOADED`, `FAILED` |
| created_at | timestamptz | |

### 4.17 `alerts` [MVP] — tiered alerts
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| tier | enum | `WATCH` (internal), `WARNING` (public), `UPDATE` (update / all-clear) |
| status | enum | `DRAFT`, `AUTO_DISPATCHED`, `APPROVED`, `DISPATCHED`, `REJECTED`, `CLOSED` |
| severity | enum | `HIGH`, `VERY_HIGH` (from the triggering assessment) |
| trigger_type | enum | `AUTOMATIC_THRESHOLD`, `MANUAL` |
| lead_time_h | smallint | `0` current, or forecast horizon |
| area_geom | geometry(MultiPolygon, 4326) | Union of affected cells |
| risk_zone_ids | uuid[] | |
| admin_boundary_id | uuid FK → admin_boundaries | |
| triggering_assessment_id | uuid FK → risk_assessments, nullable | |
| explanation_snapshot | jsonb | Factors at creation (unchangeable) |
| messages | jsonb | `{lang: {title, body, sms_text}}` rendered from reviewed templates |
| languages | text[] | |
| recommended_actions | text | |
| approved_by / approved_at | | Required for `WARNING` dispatch |
| dispatched_at / closed_at | timestamptz | |
| run_mode | enum | `LIVE`, `DEMO_REPLAY` |
| provenance | enum | `MODEL_OUTPUT` |
| is_demo | boolean | |

**Constraints (conceptual):**
- `tier = 'WARNING' AND status = 'DISPATCHED'` ⇒ `approved_by IS NOT NULL`
- `status = 'AUTO_DISPATCHED'` ⇒ `tier = 'WATCH'`
- One open alert per `(tier, risk_zone)`. Later triggers attach to it.

### 4.18 `notification_deliveries` [MVP]
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| alert_id | uuid FK → alerts | |
| recipient_id | uuid FK → users | |
| channel | enum | `APP_PUSH`, `APP_INBOX`, `SMS` |
| language | text | |
| destination_masked | text, nullable | For example `+91******1234` |
| rendered_text | text | Exact message (SMS sandbox proof) |
| status | enum | `QUEUED`, `SENT`, `SANDBOXED`, `FAILED`, `ACKNOWLEDGED` |
| channel_mode | enum | `LIVE`, `SANDBOX` |
| provider_message_id | text, nullable | Only from a real provider response |
| error | text, nullable | |
| queued_at / sent_at / acknowledged_at | timestamptz | |

**Rule:** `status = 'SENT'` requires `channel_mode = 'LIVE'`. Sandbox deliveries are always `SANDBOXED`.

### 4.19 `audit_events` [MVP, minimal]
| Column | Type | Notes |
|---|---|---|
| id | bigint PK | |
| actor_id | uuid FK → users, nullable | Null = system (for example auto-dispatch) |
| action | text | `ALERT_AUTO_DISPATCHED`, `ALERT_APPROVED`, `REPORT_VERIFIED`, `ROAD_STATUS_OVERRIDDEN`, `THRESHOLD_CHANGED`, … |
| entity_type / entity_id | text / uuid | |
| details | jsonb | |
| at | timestamptz | |

## 5. Extension tables (post-MVP)

| Table | Purpose |
|---|---|
| `organizations` | Multi-agency and multi-district operations |
| `incidents` | Grouping of reports into managed incidents with a response lifecycle |
| `alert_templates` | Template management UI (MVP: reviewed templates in config files) |
| `response_priority_snapshots` | Priority history (MVP: computed on request) |
| `data_ingestion_runs` | Per-run history (MVP: `data_sources.last_success_at` / `last_error`) |
| `road_graph_nodes` / `road_graph_edges` | Route calculation |
| `sms_opt_outs` | Production SMS compliance |
| Raster storage | PostGIS rasters or cloud-optimised GeoTIFF catalogue for live satellite feeds |

## 6. Important geographic queries

| Need | Query pattern |
|---|---|
| Risk map for viewport and lead time | `risk_assessments` (`is_latest`, `lead_time_h`) joined to `risk_zones.geom` with `ST_Intersects(bbox)` |
| Risk at a point | `ST_Contains(risk_zones.geom, point)` |
| Report → cell, nearest road segment | `ST_Contains`. Nearest-neighbour ordering on `road_segments.geom` with an `ST_DWithin` limit. |
| Road `AT_RISK` | `ST_Intersects(road_segments.geom, cells with severity ≥ HIGH)` |
| Village access at risk | All segments within X m of the village are `BLOCKED`/`AT_RISK` (`ST_DWithin` on geography) |
| Sensor → cells | `ST_DWithin(station.geom::geography, cell.centroid::geography, influence_radius_m)` |
| Exposure per cell | Count `locations` by type within or near the cell |
| Public warning recipients | Citizens with `ST_Within(registered_location, alerts.area_geom)` or `admin_boundary_id` match, and consent |

Use `geography` casts or a projected CRS for distances in metres.

## 7. Data retention and privacy

- Citizen phone numbers and registered locations: consent required, access limited to the notification module and admins, excluded from exports and logs.
- Evidence media: retention period is a 🔶 human decision (with stakeholder input).
- Demo data is flagged (`is_demo_account`, `is_demo`, `SIMULATED_DEMO`, `run_mode = DEMO_REPLAY`) and purgeable by the reset script.
