# Database Design (Conceptual) — GeoRakshak

> **Status:** CONCEPTUAL. No database, migration or DDL exists yet.
> Target: PostgreSQL + PostGIS (proposed, see [architecture.md](architecture.md)). Owner: Backend Developer.

## 1. Conventions

| Convention | Rule |
|---|---|
| Primary keys | `id UUID` |
| Timestamps | `created_at`, `updated_at` as `timestamptz` (UTC) |
| Geometry SRID | **EPSG:4326** for all stored geometry. Projected CRSs used only in computation. |
| Geometry types | Explicit type per column (for example `geometry(Point, 4326)`) |
| Spatial indexes | GiST index on every geometry column |
| Provenance | `provenance` enum on every environmental / risk / event table: `REAL_LIVE`, `REAL_HISTORICAL`, `SIMULATED_DEMO`, `MODEL_OUTPUT` |
| Soft delete | `deleted_at` on user-generated content (reports, evidence). Hard delete only by admin process. |
| Naming | `snake_case`, plural table names |
| Enums | Postgres enums or check constraints (decided at implementation) |

## 2. Entity-relationship overview

```
organizations 1───* users
users 1───* field_reports (reporter)
users 1───* alerts (approved_by)
users *───* alerts  via alert_recipients (acknowledgement)

admin_boundaries (self-referencing parent: state → district → sub-district/block)
admin_boundaries 1───* locations
admin_boundaries 1───* risk_zones

data_sources 1───* environmental_observations
data_sources 1───* historical_landslides
data_sources 1───* data_ingestion_runs

risk_zones (grid cells / polygons)
risk_zones 1───* environmental_observations   (aggregated to cell)
risk_zones 1───* risk_assessments             (time series of scores)
model_versions 1───* risk_assessments
risk_assessments 1───* risk_factors           (explanations)

risk_zones 1───* alerts
risk_assessments 1───* alerts (triggering assessment)
alerts 1───* alert_messages                   (per language)
alert_templates 1───* alert_messages

incidents 1───* field_reports
alerts 0..1───* incidents
risk_zones 1───* incidents
field_reports 1───* evidence

locations (villages, road segments, facilities) ── exposure for priority
incidents 1───* response_priorities (history)

audit_log (polymorphic: entity_type + entity_id)
```

## 3. Core tables

### 3.1 `organizations` *(supporting)*
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | For example a district disaster management authority (demo entries are fictional) |
| type | enum | `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `LINE_DEPARTMENT`, `OTHER` |
| jurisdiction_boundary_id | uuid FK → admin_boundaries | |

### 3.2 `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid FK → organizations | |
| full_name | text | |
| email | text unique, nullable | |
| phone | text, nullable | Personal data, access-restricted |
| password_hash | text, nullable | Null if an external identity provider is used |
| role | enum | `ADMIN`, `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `FIELD_OFFICER` |
| preferred_language | text | BCP 47 code, for example `en`, `hi`, `as` |
| is_active | boolean | |
| last_known_location | geometry(Point, 4326), nullable | Only stored if a consented, explicit feature needs it |
| is_demo_account | boolean | True for `SIMULATED_DEMO` users |
| created_at / updated_at | timestamptz | |

### 3.3 `admin_boundaries` *(supporting)*
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| level | enum | `COUNTRY`, `STATE`, `DISTRICT`, `SUBDISTRICT`, `BLOCK`, `VILLAGE` |
| name | text | |
| lgd_code | text, nullable | Local Government Directory code (canonical join key) |
| parent_id | uuid FK → admin_boundaries | |
| geom | geometry(MultiPolygon, 4326) | |
| source_id | uuid FK → data_sources | |

### 3.4 `locations`
Named places relevant to exposure and response.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| type | enum | `VILLAGE`, `TOWN`, `ROAD_SEGMENT`, `BRIDGE`, `SCHOOL`, `HEALTH_FACILITY`, `SHELTER`, `OTHER` |
| name | text | |
| geom | geometry(Geometry, 4326) | Point for villages/facilities, LineString for roads |
| admin_boundary_id | uuid FK → admin_boundaries | |
| population | integer, nullable | With `population_source_year` (for example 2011) |
| population_source_year | smallint, nullable | |
| attributes | jsonb | For example OSM tags, road class |
| source_id | uuid FK → data_sources | |
| provenance | enum | |

### 3.5 `risk_zones`
Analysis units: grid cells (MVP), later optionally slope units or polygons.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| zone_type | enum | `GRID_CELL`, `SLOPE_UNIT`, `CUSTOM_POLYGON` |
| grid_code | text unique, nullable | Stable cell identifier |
| geom | geometry(Polygon, 4326) | |
| centroid | geometry(Point, 4326) | Precomputed |
| admin_boundary_id | uuid FK → admin_boundaries | District (and block) containing the centroid |
| static_features | jsonb | slope_deg, elevation_m, relief_m, landcover, etc., with a feature version |
| static_feature_version | text | |
| susceptibility_score | real, nullable | Latest Stage A score (denormalised for fast maps) |
| current_risk_class | enum, nullable | Denormalised latest class: `LOW`, `MODERATE`, `HIGH`, `VERY_HIGH` |
| current_assessment_id | uuid FK → risk_assessments, nullable | |

### 3.6 `environmental_observations`
| Column | Type | Notes |
|---|---|---|
| id | bigserial / uuid PK | High volume. A partitioning strategy (by time) is decided later. |
| risk_zone_id | uuid FK → risk_zones, nullable | Set when aggregated to a cell |
| geom | geometry(Geometry, 4326), nullable | Original point/footprint where relevant |
| variable | enum/text | `RAINFALL`, `SOIL_MOISTURE`, `NDVI`, … |
| aggregation | text | For example `sum_24h`, `sum_72h`, `mean_daily` |
| value | double precision | |
| unit | text | `mm`, `m3/m3`, … |
| observed_start / observed_end | timestamptz | Validity window |
| is_forecast | boolean | Forecasts must never be confused with observations |
| source_id | uuid FK → data_sources | |
| ingestion_run_id | uuid FK → data_ingestion_runs | |
| provenance | enum | |
| quality_flag | text, nullable | |

Unique constraint (conceptual): `(risk_zone_id, variable, aggregation, observed_start, observed_end, source_id)`.

### 3.7 `historical_landslides`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| geom | geometry(Geometry, 4326) | Point or polygon as provided |
| event_date | date, nullable | Many inventory records lack dates |
| event_date_precision | enum | `EXACT`, `MONTH`, `YEAR`, `UNKNOWN` |
| location_accuracy_m | real, nullable | From source if available |
| trigger | text, nullable | For example rainfall, earthquake, unknown |
| landslide_type | text, nullable | As given in the source |
| fatalities | integer, nullable | Only if in the source. Never estimated. |
| description | text, nullable | |
| source_id | uuid FK → data_sources | |
| source_record_id | text | ID in the original dataset |
| provenance | enum | Normally `REAL_HISTORICAL` |
| used_in_training | boolean | |

### 3.8 `incidents`
An operational event being handled by authorities. It may group multiple field reports.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text | |
| status | enum | `OPEN`, `IN_RESPONSE`, `RESOLVED`, `ESCALATED` |
| category | enum | `LANDSLIDE`, `CRACK`, `SEEPAGE`, `ROCKFALL`, `ROAD_BLOCKED`, `SUBSIDENCE`, `OTHER` |
| severity | enum | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` (highest verified) |
| geom | geometry(Point, 4326) | Representative location |
| risk_zone_id | uuid FK → risk_zones | |
| alert_id | uuid FK → alerts, nullable | Alert that prompted verification, if any |
| verification_status | enum | `UNVERIFIED`, `VERIFIED`, `REJECTED` |
| provenance | enum | `REAL_LIVE` in operations. `SIMULATED_DEMO` in the demo. |
| created_by | uuid FK → users | |
| opened_at / resolved_at | timestamptz | |

### 3.9 `field_reports`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | Server ID |
| client_report_id | uuid **unique** | Generated on device. **Idempotency key for the offline sync.** |
| reporter_id | uuid FK → users | |
| incident_id | uuid FK → incidents, nullable | Linked automatically or by the authority |
| alert_id | uuid FK → alerts, nullable | If the report answers an alert/task |
| category | enum | Same as incidents |
| severity | enum | Reporter's assessment |
| description | text | |
| language | text | BCP 47 |
| geom | geometry(Point, 4326) | Device GPS |
| gps_accuracy_m | real | |
| altitude_m | real, nullable | |
| captured_at | timestamptz | Device time when the report was created (may be offline) |
| submitted_at | timestamptz | Server receipt time |
| device_info | jsonb | App version, OS (no unnecessary identifiers) |
| verification_status | enum | `UNVERIFIED`, `VERIFIED`, `REJECTED` |
| verified_by | uuid FK → users, nullable | |
| verified_at | timestamptz, nullable | |
| verification_note | text, nullable | |
| provenance | enum | |
| deleted_at | timestamptz, nullable | |

### 3.10 `evidence`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| field_report_id | uuid FK → field_reports | |
| client_evidence_id | uuid unique | Idempotency for media upload |
| media_type | enum | `PHOTO`, `VIDEO`, `AUDIO` (future) |
| mime_type | text | Validated server-side |
| storage_key | text | Object storage key. **Files are never stored in the DB.** |
| size_bytes | bigint | |
| sha256 | text | Integrity and deduplication |
| duration_s | real, nullable | Video |
| geom | geometry(Point, 4326), nullable | From EXIF or device, if available |
| captured_at | timestamptz, nullable | |
| upload_status | enum | `PENDING`, `UPLOADED`, `FAILED` |
| created_at | timestamptz | |

### 3.11 `alerts`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| status | enum | `DRAFT`, `APPROVED`, `PUBLISHED`, `REJECTED`, `CLOSED` |
| severity | enum | Maps from risk class: `ADVISORY`, `WATCH`, `WARNING` (names to be reviewed; must not be mistaken for official agency terminology) |
| risk_zone_id | uuid FK → risk_zones, nullable | |
| area_geom | geometry(MultiPolygon, 4326) | Affected area (may merge several cells) |
| admin_boundary_id | uuid FK → admin_boundaries | Jurisdiction |
| triggering_assessment_id | uuid FK → risk_assessments, nullable | |
| trigger_type | enum | `AUTOMATIC_THRESHOLD`, `MANUAL` |
| explanation_snapshot | jsonb | Factors at draft time (immutable) |
| recommended_actions | text | |
| valid_from / valid_until | timestamptz | |
| created_by_system | boolean | |
| approved_by | uuid FK → users, nullable | **Required for `PUBLISHED`** |
| approved_at / published_at / closed_at | timestamptz | |
| provenance | enum | `MODEL_OUTPUT` (automatic) and/or `SIMULATED_DEMO` input flag |
| is_demo | boolean | |

Constraint (conceptual): `status = 'PUBLISHED'` ⇒ `approved_by IS NOT NULL`.

## 4. Supporting tables

| Table | Purpose | Key columns |
|---|---|---|
| `data_sources` | Registry of datasets (see [data-strategy.md §13](data-strategy.md)) | provider, dataset, version, licence, attribution_text, status, provenance_default |
| `data_ingestion_runs` | Each ingestion job run | source_id, started_at, finished_at, window_start/end, status, rows_written, error |
| `model_versions` | Registered models | version, model_type, git_commit, data_version, feature_config, metrics jsonb, model_card_uri, is_active |
| `risk_assessments` | Time series of scores per zone | risk_zone_id, model_version_id, assessed_at, valid_from/until, score, risk_class, confidence, input_provenance (did inputs include simulated data?), provenance=`MODEL_OUTPUT` |
| `risk_factors` | Explanation rows | risk_assessment_id, feature, label, value, unit, contribution, direction, rank |
| `alert_templates` | Human-reviewed message templates | severity, language, title_template, body_template, reviewed_by, version |
| `alert_messages` | Rendered alert per language | alert_id, language, title, body, template_id |
| `alert_recipients` | Delivery and acknowledgement | alert_id, user_id, channel (`IN_APP`), delivered_at, acknowledged_at |
| `response_priorities` | Priority snapshots | incident_id / risk_zone_id, score, rank, reasons jsonb, computed_at, rule_version |
| `audit_log` | Accountability | actor_id, action, entity_type, entity_id, before jsonb, after jsonb, at |

## 5. Important geographic fields and queries

| Need | Geometry | Query pattern |
|---|---|---|
| Risk map for a viewport | `risk_zones.geom` | `ST_Intersects(geom, ST_MakeEnvelope(...))` + current class |
| Risk at a tapped point | `risk_zones.geom` | `ST_Contains(geom, point)` |
| Link a report to a zone | `field_reports.geom` → `risk_zones.geom` | `ST_Contains` |
| Attach a report to a nearby open incident | `incidents.geom` | `ST_DWithin(geography, radius_m)` + time window |
| Exposure for priority | `locations.geom` within alert/zone area | `ST_DWithin` / `ST_Intersects` |
| Past landslides near a zone | `historical_landslides.geom` | `ST_DWithin` on geography |
| Jurisdiction filter | `admin_boundaries.geom` | `ST_Within` / FK |

Notes:
- Use the `geography` cast or a projected CRS for distances in metres.
- Simplified geometry variants (or vector tiles) may be needed for map performance at wider zoom. Decide in Phase 2.

## 6. Data retention and privacy (initial)

- Evidence media and reports are retained per a policy to be agreed with the stakeholder (🔶 human decision).
- Phone numbers and precise user locations are access-controlled and excluded from analytics exports.
- Demo data lives in a separate database or schema, or is flagged with `is_demo` / `provenance = SIMULATED_DEMO`, so it can be purged.
