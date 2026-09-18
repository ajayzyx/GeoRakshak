-- GeoRakshak MVP schema v1 (docs/database.md). All geometry EPSG:4326.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE provenance AS ENUM ('REAL_LIVE', 'REAL_HISTORICAL', 'SIMULATED_DEMO', 'MODEL_OUTPUT');
CREATE TYPE connection_status AS ENUM ('CONNECTED_LIVE', 'CONNECTED_HISTORICAL', 'SIMULATED', 'SANDBOX', 'AWAITING_ACCESS', 'NOT_CONNECTED');
CREATE TYPE user_role AS ENUM ('ADMIN', 'STATE_AUTHORITY', 'DISTRICT_AUTHORITY', 'FIELD_OFFICER', 'CITIZEN');
CREATE TYPE severity AS ENUM ('LOW', 'MODERATE', 'HIGH', 'VERY_HIGH');
CREATE TYPE confidence AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE run_mode AS ENUM ('LIVE', 'DEMO_REPLAY');
CREATE TYPE road_status AS ENUM ('OPEN', 'AT_RISK', 'BLOCKED', 'UNKNOWN');
CREATE TYPE road_status_source AS ENUM ('MODEL_RISK', 'VERIFIED_REPORT', 'AUTHORITY_OVERRIDE', 'NONE');
CREATE TYPE access_status AS ENUM ('OK', 'ACCESS_AT_RISK', 'UNKNOWN');
CREATE TYPE report_category AS ENUM ('LANDSLIDE', 'CRACK', 'SEEPAGE', 'ROCKFALL', 'ROAD_BLOCKED', 'SUBSIDENCE', 'OTHER');
CREATE TYPE report_severity AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE verification_status AS ENUM ('UNVERIFIED', 'VERIFIED', 'REJECTED');
CREATE TYPE media_type AS ENUM ('PHOTO', 'VIDEO');
CREATE TYPE upload_status AS ENUM ('PENDING', 'UPLOADED', 'FAILED');
CREATE TYPE alert_tier AS ENUM ('WATCH', 'WARNING', 'UPDATE');
CREATE TYPE alert_status AS ENUM ('DRAFT', 'AUTO_DISPATCHED', 'APPROVED', 'DISPATCHED', 'REJECTED', 'CLOSED');
CREATE TYPE notification_channel AS ENUM ('APP_PUSH', 'APP_INBOX', 'SMS');
CREATE TYPE channel_mode AS ENUM ('LIVE', 'SANDBOX');
CREATE TYPE delivery_status AS ENUM ('QUEUED', 'SENT', 'SANDBOXED', 'FAILED', 'ACKNOWLEDGED');

CREATE TABLE data_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text UNIQUE NOT NULL,
    kind text NOT NULL,
    provider text NOT NULL,
    dataset text NOT NULL,
    connection_status connection_status NOT NULL,
    status_note text,
    access_requested_at timestamptz,
    last_success_at timestamptz,
    last_error text,
    verification_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'REJECTED')),
    verified_at date,
    licence text,
    attribution_text text,
    provenance_default provenance,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE admin_boundaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    level text NOT NULL CHECK (level IN ('STATE', 'DISTRICT', 'SUBDISTRICT', 'BLOCK', 'VILLAGE', 'PILOT_AREA')),
    name text NOT NULL,
    lgd_code text,
    parent_id uuid REFERENCES admin_boundaries(id),
    geom geometry(MultiPolygon, 4326) NOT NULL,
    note text,
    source_id uuid REFERENCES data_sources(id)
);
CREATE INDEX ON admin_boundaries USING gist (geom);

CREATE TABLE pilot_area (
    slug text PRIMARY KEY,
    name text NOT NULL,
    status text NOT NULL CHECK (status IN ('PROVISIONAL', 'SELECTED', 'MOCK')),
    bbox double precision[] NOT NULL,
    cell_size_m real NOT NULL,
    boundary_id uuid REFERENCES admin_boundaries(id),
    boundary_note text,
    manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    loaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name text NOT NULL,
    email text UNIQUE,
    phone text,
    phone_consent_at timestamptz,
    password_hash text NOT NULL,
    role user_role NOT NULL,
    admin_boundary_id uuid REFERENCES admin_boundaries(id),
    registered_location geometry(Point, 4326),
    preferred_language text NOT NULL DEFAULT 'en',
    sms_enabled boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    is_demo_account boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (phone IS NULL OR phone_consent_at IS NOT NULL)
);

CREATE TABLE user_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
    push_token text NOT NULL,
    app_version text,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, push_token)
);

CREATE TABLE model_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text UNIQUE NOT NULL,
    model_type text NOT NULL,
    stage text NOT NULL,
    git_commit text,
    data_version text,
    feature_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
    sensor_modifier_config jsonb,
    validation_scheme text,
    metrics jsonb,
    forecast_skill_evaluated boolean NOT NULL DEFAULT false,
    model_card_uri text,
    is_active boolean NOT NULL DEFAULT false,
    registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    grid_code text UNIQUE NOT NULL,
    geom geometry(Polygon, 4326) NOT NULL,
    centroid geometry(Point, 4326) NOT NULL,
    admin_boundary_id uuid REFERENCES admin_boundaries(id),
    static_features jsonb NOT NULL DEFAULT '{}'::jsonb,
    feature_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    static_feature_version text,
    current_severity severity,
    current_assessment_id uuid
);
CREATE INDEX ON risk_zones USING gist (geom);
CREATE INDEX ON risk_zones USING gist (centroid);

CREATE TABLE rainfall_observations (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    risk_zone_id uuid NOT NULL REFERENCES risk_zones(id) ON DELETE CASCADE,
    period_start timestamptz NOT NULL,
    period_end timestamptz NOT NULL,
    rainfall_mm double precision NOT NULL,
    source_id uuid NOT NULL REFERENCES data_sources(id),
    provenance provenance NOT NULL,
    quality_flag text,
    UNIQUE (risk_zone_id, period_start, period_end, source_id)
);

CREATE TABLE rainfall_forecasts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    risk_zone_id uuid NOT NULL REFERENCES risk_zones(id) ON DELETE CASCADE,
    issue_time timestamptz NOT NULL,
    valid_start timestamptz NOT NULL,
    valid_end timestamptz NOT NULL,
    lead_time_h smallint NOT NULL CHECK (lead_time_h IN (24, 48, 72)),
    rainfall_mm double precision NOT NULL,
    source_id uuid NOT NULL REFERENCES data_sources(id),
    provenance provenance NOT NULL,
    UNIQUE (risk_zone_id, issue_time, lead_time_h, source_id)
);

CREATE TABLE sensor_stations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    station_code text UNIQUE NOT NULL,
    name text NOT NULL,
    station_type text NOT NULL CHECK (station_type IN ('VIRTUAL', 'PHYSICAL')),
    geom geometry(Point, 4326) NOT NULL,
    variables text[] NOT NULL DEFAULT ARRAY['SOIL_MOISTURE_VWC'],
    depth_cm real,
    influence_radius_m real NOT NULL DEFAULT 1500,
    api_key_hash text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    source_id uuid REFERENCES data_sources(id),
    provenance provenance NOT NULL,
    last_reading_at timestamptz,
    CHECK (station_type <> 'VIRTUAL' OR provenance = 'SIMULATED_DEMO')
);
CREATE INDEX ON sensor_stations USING gist (geom);

CREATE TABLE sensor_readings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    station_id uuid NOT NULL REFERENCES sensor_stations(id) ON DELETE CASCADE,
    variable text NOT NULL,
    value double precision NOT NULL,
    unit text NOT NULL,
    observed_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    quality_flag text NOT NULL DEFAULT 'OK' CHECK (quality_flag IN ('OK', 'SUSPECT', 'OUT_OF_RANGE')),
    provenance provenance NOT NULL,
    UNIQUE (station_id, variable, observed_at)
);

CREATE TABLE historical_landslides (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    geom geometry(Geometry, 4326) NOT NULL,
    event_date date,
    event_date_precision text NOT NULL DEFAULT 'UNKNOWN' CHECK (event_date_precision IN ('EXACT', 'MONTH', 'YEAR', 'UNKNOWN')),
    location_accuracy_m real,
    trigger text,
    landslide_type text,
    fatalities integer,
    source_id uuid NOT NULL REFERENCES data_sources(id),
    source_record_id text,
    provenance provenance NOT NULL,
    used_in_training boolean NOT NULL DEFAULT false
);
CREATE INDEX ON historical_landslides USING gist (geom);

CREATE TABLE risk_assessments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    risk_zone_id uuid NOT NULL REFERENCES risk_zones(id) ON DELETE CASCADE,
    model_version_id uuid NOT NULL REFERENCES model_versions(id),
    lead_time_h smallint NOT NULL DEFAULT 0 CHECK (lead_time_h IN (0, 24, 48, 72)),
    issue_time timestamptz NOT NULL,
    valid_from timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    score real NOT NULL CHECK (score >= 0 AND score <= 1),
    severity severity NOT NULL,
    confidence confidence NOT NULL,
    factors jsonb NOT NULL,
    input_provenance text[] NOT NULL,
    forecast_source_id uuid REFERENCES data_sources(id),
    run_mode run_mode NOT NULL,
    is_latest boolean NOT NULL DEFAULT true,
    provenance provenance NOT NULL DEFAULT 'MODEL_OUTPUT',
    CHECK (lead_time_h = 0 OR forecast_source_id IS NOT NULL)
);
CREATE UNIQUE INDEX risk_assessments_latest ON risk_assessments (risk_zone_id, lead_time_h, run_mode) WHERE is_latest;
ALTER TABLE risk_zones ADD CONSTRAINT risk_zones_current_assessment_fk
    FOREIGN KEY (current_assessment_id) REFERENCES risk_assessments(id) ON DELETE SET NULL;

CREATE TABLE locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL CHECK (type IN ('VILLAGE', 'TOWN', 'SCHOOL', 'HEALTH_FACILITY', 'BRIDGE', 'SHELTER', 'OTHER')),
    name text,
    geom geometry(Geometry, 4326) NOT NULL,
    admin_boundary_id uuid REFERENCES admin_boundaries(id),
    population integer,
    population_source_year smallint,
    access_status access_status NOT NULL DEFAULT 'UNKNOWN',
    access_status_reason text,
    access_status_updated_at timestamptz,
    osm_id text,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_id uuid REFERENCES data_sources(id),
    provenance provenance NOT NULL
);
CREATE INDEX ON locations USING gist (geom);

CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_report_id uuid UNIQUE NOT NULL,
    reporter_id uuid NOT NULL REFERENCES users(id),
    reporter_role user_role NOT NULL CHECK (reporter_role IN ('FIELD_OFFICER', 'CITIZEN')),
    alert_id uuid,
    category report_category NOT NULL,
    severity report_severity NOT NULL,
    description text NOT NULL DEFAULT '',
    language text NOT NULL DEFAULT 'en',
    geom geometry(Point, 4326) NOT NULL,
    gps_accuracy_m real NOT NULL CHECK (gps_accuracy_m > 0),
    location_adjusted_manually boolean NOT NULL DEFAULT false,
    captured_at timestamptz NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    risk_zone_id uuid REFERENCES risk_zones(id),
    road_segment_id uuid,
    media_expected smallint NOT NULL DEFAULT 0,
    verification_status verification_status NOT NULL DEFAULT 'UNVERIFIED',
    verified_by uuid REFERENCES users(id),
    verified_at timestamptz,
    verification_note text,
    device_info jsonb NOT NULL DEFAULT '{}'::jsonb,
    provenance provenance NOT NULL,
    deleted_at timestamptz
);
CREATE INDEX ON reports USING gist (geom);

CREATE TABLE road_segments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    osm_way_id text,
    name text,
    road_class text,
    geom geometry(LineString, 4326) NOT NULL,
    status road_status NOT NULL DEFAULT 'UNKNOWN',
    status_source road_status_source NOT NULL DEFAULT 'NONE',
    status_reason text,
    status_lead_time_h smallint,
    status_report_id uuid REFERENCES reports(id),
    status_updated_by uuid REFERENCES users(id),
    status_updated_at timestamptz NOT NULL DEFAULT now(),
    source_id uuid REFERENCES data_sources(id),
    provenance provenance NOT NULL
);
CREATE INDEX ON road_segments USING gist (geom);
ALTER TABLE reports ADD CONSTRAINT reports_road_segment_fk FOREIGN KEY (road_segment_id) REFERENCES road_segments(id);

CREATE TABLE evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    client_media_id uuid UNIQUE NOT NULL,
    media_type media_type NOT NULL,
    mime_type text NOT NULL,
    storage_key text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    duration_s real,
    geom geometry(Point, 4326),
    captured_at timestamptz,
    upload_status upload_status NOT NULL DEFAULT 'UPLOADED',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tier alert_tier NOT NULL,
    status alert_status NOT NULL,
    severity severity NOT NULL,
    trigger_type text NOT NULL CHECK (trigger_type IN ('AUTOMATIC_THRESHOLD', 'MANUAL')),
    lead_time_h smallint NOT NULL DEFAULT 0,
    area_geom geometry(MultiPolygon, 4326) NOT NULL,
    risk_zone_ids uuid[] NOT NULL,
    admin_boundary_id uuid REFERENCES admin_boundaries(id),
    triggering_assessment_id uuid REFERENCES risk_assessments(id) ON DELETE SET NULL,
    explanation_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
    messages jsonb NOT NULL DEFAULT '{}'::jsonb,
    languages text[] NOT NULL DEFAULT ARRAY['en'],
    recommended_actions text NOT NULL DEFAULT '',
    valid_until timestamptz,
    approved_by uuid REFERENCES users(id),
    approved_at timestamptz,
    dispatched_at timestamptz,
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    run_mode run_mode NOT NULL,
    provenance provenance NOT NULL DEFAULT 'MODEL_OUTPUT',
    is_demo boolean NOT NULL DEFAULT false,
    -- Tiered policy (CLAUDE.md §4a): a public WARNING never dispatches without approval; only WATCH auto-dispatches.
    CHECK (NOT (tier = 'WARNING' AND status = 'DISPATCHED' AND approved_by IS NULL)),
    CHECK (status <> 'AUTO_DISPATCHED' OR tier = 'WATCH')
);
CREATE INDEX ON alerts USING gist (area_geom);
ALTER TABLE reports ADD CONSTRAINT reports_alert_fk FOREIGN KEY (alert_id) REFERENCES alerts(id);

CREATE TABLE notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id uuid NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES users(id),
    channel notification_channel NOT NULL,
    language text NOT NULL,
    destination_masked text,
    rendered_text text NOT NULL,
    status delivery_status NOT NULL,
    channel_mode channel_mode NOT NULL,
    provider_message_id text,
    error text,
    queued_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    acknowledged_at timestamptz,
    CHECK (status <> 'SENT' OR channel_mode = 'LIVE'),
    CHECK (channel_mode <> 'SANDBOX' OR status IN ('SANDBOXED', 'FAILED'))
);

CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id uuid REFERENCES users(id),
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_state (
    key text PRIMARY KEY,
    value jsonb NOT NULL
);
