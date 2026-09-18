// Types mirroring docs/api.md (FROZEN contract v1). Keep in sync with that file only.

// §6.1 enums
export const PROVENANCES = ["REAL_LIVE", "REAL_HISTORICAL", "SIMULATED_DEMO", "MODEL_OUTPUT"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const CONNECTION_STATUSES = [
  "CONNECTED_LIVE",
  "CONNECTED_HISTORICAL",
  "SIMULATED",
  "SANDBOX",
  "AWAITING_ACCESS",
  "NOT_CONNECTED",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const SEVERITIES = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ROAD_STATUSES = ["OPEN", "AT_RISK", "BLOCKED", "UNKNOWN"] as const;
export type RoadStatus = (typeof ROAD_STATUSES)[number];

export type AlertTier = "WATCH" | "WARNING" | "UPDATE";
export type AlertStatus = "DRAFT" | "AUTO_DISPATCHED" | "APPROVED" | "DISPATCHED" | "REJECTED" | "CLOSED";
export type DeliveryStatus = "QUEUED" | "SENT" | "SANDBOXED" | "FAILED" | "ACKNOWLEDGED";
export type RunMode = "LIVE" | "DEMO_REPLAY";
export type Confidence = "LOW" | "MEDIUM" | "HIGH";
export type Role = "ADMIN" | "STATE_AUTHORITY" | "DISTRICT_AUTHORITY" | "FIELD_OFFICER" | "CITIZEN";
export type VerificationStatus = "UNVERIFIED" | "VERIFIED" | "REJECTED";
export type LeadTime = 0 | 24 | 48 | 72;
export const LEAD_TIMES: readonly LeadTime[] = [0, 24, 48, 72];

// §1 error envelope
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: { field?: string; issue?: string }[];
    request_id?: string;
  };
}

// GeoJSON (RFC 7946), narrowed to what we render
export type Position = [number, number];
export type Geometry =
  | { type: "Point"; coordinates: Position }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] }
  | { type: "MultiLineString"; coordinates: Position[][] };

export interface Feature<P> {
  type: "Feature";
  id?: string;
  geometry: Geometry;
  properties: P;
}

// §6.3 collection metadata (all optional: each collection includes the subset that applies)
export interface CollectionMetadata {
  run_mode?: RunMode;
  lead_time_h?: number;
  issue_time?: string;
  valid_from?: string;
  valid_until?: string;
  model_version?: string;
  forecast_source?: { slug: string; label: string; connection_status?: ConnectionStatus } | null;
  input_provenance?: Provenance[];
  provenance?: Provenance;
  forecast_skill_evaluated?: boolean;
  disclaimer?: string;
  attribution?: string;
  status_semantics?: string;
  // Layer metadata (e.g. GET /layers/landcover)
  source_slug?: string;
  dataset?: string;
  connection_status?: ConnectionStatus;
  acquisition_start?: string | null;
  acquisition_end?: string | null;
  acquisition_note?: string | null;
  class_labels?: Record<string, string>;
  note?: string;
}

export interface FeatureCollection<P> {
  type: "FeatureCollection";
  metadata?: CollectionMetadata;
  features: Feature<P>[];
}

// §5.14 login / user
export interface User {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  preferred_language: string;
  admin_boundary_id: string | null;
  is_demo_account: boolean;
}
export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

// §5.13 system mode
export interface ReplayState {
  scenario: string;
  provenance: Provenance;
  /** Zero-based index of the current replay day; valid values are 0..steps-1. */
  step: number;
  steps: number;
  as_of?: string | null;
}
/** What the last monitoring cycle produced. */
export interface MonitorResult {
  scored?: number | null;
  model_version?: string | null;
  roads_at_risk?: number | null;
  villages_access_at_risk?: number | null;
  watch_created?: string | null;
  forecast_watch_created?: string | null;
  warning_draft_created?: string | null;
  watches_auto_closed?: number | string[] | null;
}

/** What the last weather ingest fetched. `is_imd` says whether the provider is IMD (H16). */
export interface MonitorWeather {
  provider: string;
  /** Set when a scheduled cycle reused a recent fetch instead of calling the provider. */
  skipped?: string | null;
  min_interval_s?: number | null;
  last_fetch_at?: string | null;
  points?: number | null;
  observations?: number | null;
  forecasts?: number | null;
  observed_source?: string | null;
  forecast_source?: string | null;
  is_imd: boolean;
}

export interface MonitorState {
  enabled: boolean;
  /** Newest successful cycle; kept across a later failure. */
  last_success_at?: string | null;
  interval_s: number | null;
  weather_provider: string | null;
  last_run_at: string | null;
  last_status: "OK" | "FAILED" | null;
  last_error: string | null;
  next_run_at: string | null;
  result: MonitorResult | null;
  weather: MonitorWeather | null;
  weather_error: string | null;
  /** In DEMO_REPLAY: says cycles run on replay steps rather than on a timer. */
  note?: string | null;
}

export interface SystemMode {
  run_mode: RunMode;
  /** null in DEMO_REPLAY means the replay has not been started. */
  replay?: ReplayState | null;
  monitor?: MonitorState | null;
}

// GET /audit-events. `actor: null` means the system acted automatically.
export interface AuditEvent {
  id: number | string;
  at: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details?: Record<string, unknown> | null;
  actor: { id: string; full_name: string; role: Role } | null;
}
export interface AuditEventsResponse {
  items: AuditEvent[];
  note?: string | null;
}

// GET /system/status — the judge-facing view. `effective_label` is the display vocabulary.
export const EFFECTIVE_LABELS = ["REAL_LIVE", "REAL_REPLAY", "REAL_HISTORICAL", "SIMULATED", "SANDBOX", "AWAITING_ACCESS", "NOT_CONNECTED"] as const;
export type EffectiveLabel = (typeof EFFECTIVE_LABELS)[number];

export interface StatusAdapter extends DataSource {
  effective_label: EffectiveLabel;
  /** Seconds since `last_success_at`; null when it never succeeded. */
  age_s: number | null;
  is_imd: boolean;
}
export type AdapterGroupKey = "weather" | "satellite" | "sensor" | "inventory" | "terrain" | "exposure" | "notification" | "other";
export interface StatusModel {
  version: string;
  model_type: string;
  stage: string;
  calibrated: boolean;
  validated: boolean;
  metrics: Record<string, unknown> | null;
  validation_scheme: string | null;
  forecast_skill_evaluated: boolean;
  model_card_uri: string | null;
}
export interface SystemStatus {
  run_mode: RunMode;
  replay: ReplayState | null;
  monitor: MonitorState | null;
  pilot: { slug: string; name: string; status: "PROVISIONAL" | "SELECTED" } | null;
  model: StatusModel | null;
  adapters: Partial<Record<AdapterGroupKey, StatusAdapter[]>>;
  label_counts: Partial<Record<EffectiveLabel, number>>;
  labels: Partial<Record<EffectiveLabel, string>>;
  disclaimer: string;
  as_of: string;
}

/** POST /system/monitor/run */
export interface MonitorRunResponse {
  last_run_at: string | null;
  last_status: "OK" | "FAILED" | null;
  last_error: string | null;
  duration_s?: number | null;
  trigger?: string | null;
  run_mode?: RunMode;
  result: MonitorResult | null;
  weather: MonitorWeather | null;
  weather_error: string | null;
}
export interface DemoReplayResponse {
  replay: ReplayState | null;
  cycle?: unknown;
}

// GET /models/active (api.md §4; field list per §7.1 active_model())
export interface ActiveModel {
  version: string;
  model_type: string;
  stage: string;
  feature_config?: unknown;
  feature_list?: unknown;
  thresholds?: { calibrated?: boolean; note?: string; [k: string]: unknown } | null;
  /** From GET /system/status; false for the rule-based baseline. */
  validated?: boolean;
  validation_scheme: string | null;
  metrics: Record<string, unknown> | null;
  forecast_skill_evaluated: boolean;
  model_card_uri: string | null;
  registered_at?: string | null;
}

// §5.14 pilot
export interface Pilot {
  slug: string;
  name: string;
  status: "PROVISIONAL" | "SELECTED";
  bbox: [number, number, number, number];
  cell_size_m: number;
  boundary: Geometry | null;
  boundary_note: string | null;
}

// §5.1 data sources
export interface DataSource {
  slug: string;
  kind: string;
  provider?: string | null;
  dataset?: string | null;
  licence?: string | null;
  provenance_default?: Provenance | null;
  last_error?: string | null;
  verified_at?: string | null;
  access_requested_at?: string | null;
  connection_status: ConnectionStatus;
  verification_status?: string;
  last_success_at?: string | null;
  attribution_text?: string | null;
  status_note?: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface DataSourcesResponse {
  run_mode: RunMode;
  items: DataSource[];
}

// §5.14 dashboard summary
export interface DashboardSummary {
  run_mode: RunMode;
  risk_zone_counts: Record<Severity, number>;
  alerts: { DRAFT: number; AUTO_DISPATCHED: number; DISPATCHED: number };
  reports: Record<VerificationStatus, number>;
  road_segments: Record<RoadStatus, number>;
  as_of: string | null;
}

// §5.2 risk zones
export interface RiskZoneProps {
  grid_code: string;
  severity: Severity;
  score: number;
  confidence: Confidence;
}
export type RiskZoneCollection = FeatureCollection<RiskZoneProps>;

// §6.2 factor
export interface Factor {
  feature: string;
  label: string;
  value: number | string | null;
  unit: string | null;
  contribution: number;
  direction: "increases_risk" | "decreases_risk";
  component: "SUSCEPTIBILITY" | "TRIGGER" | "SENSOR_ADJUSTMENT";
  text: string;
  provenance: Provenance;
  station_code?: string;
}

// §5.3 risk zone detail
export interface RiskZoneDetail {
  id: string;
  grid_code: string;
  admin_boundary: { id: string; name: string } | null;
  assessment: {
    id: string;
    lead_time_h: number;
    score: number;
    severity: Severity;
    confidence: Confidence;
    model_version: string;
    issue_time: string;
    run_mode: RunMode;
    provenance: Provenance;
    valid_from?: string | null;
    valid_until?: string | null;
    input_provenance?: Provenance[];
    forecast_source?: string | null;
    forecast_skill_evaluated?: boolean;
    factors: Factor[];
  } | null;
  exposure: {
    villages: number;
    schools: number;
    health_facilities: number;
    road_segments_at_risk: number;
    road_segments_blocked?: number;
    villages_access_at_risk?: number;
  };
  open_alerts: { id: string; tier: AlertTier; status: AlertStatus }[];
  disclaimer: string;
}

// §5.4 road segments
export interface RoadSegmentProps {
  osm_way_id?: number | string | null;
  name?: string | null;
  road_class: string;
  status: RoadStatus;
  status_source: string | null;
  status_reason: string | null;
  status_report_id: string | null;
  status_updated_at: string | null;
  /** In api.md §5.4; not every backend build returns it. */
  villages_access_at_risk?: number | null;
  provenance?: Provenance;
}
export type RoadSegmentCollection = FeatureCollection<RoadSegmentProps>;
export type RoadSegmentFeature = Feature<RoadSegmentProps>;

// §5.14 layers
export interface LocationProps {
  type: string;
  name: string;
  access_status: string | null;
  access_status_reason?: string | null;
  population: number | null;
  population_source_year: number | null;
  source_slug: string;
  provenance?: Provenance;
}
export interface HistoricalLandslideProps {
  event_date: string | null;
  event_date_precision: string | null;
  trigger: string | null;
  landslide_type: string | null;
  location_accuracy_m: number | null;
  source_slug: string;
  provenance?: Provenance;
}
export interface SatelliteLayer {
  slug: string;
  title: string;
  kind: "IMAGERY" | "NDVI" | "LANDCOVER";
  acquisition_start: string | null;
  acquisition_end: string | null;
  bounds: [number, number, number, number] | null;
  display: { type: "image"; url: string } | null;
  attribution_text: string | null;
  provenance: Provenance;
}

// GET /layers/landcover — one majority class per analysis cell (not an image).
export interface LandcoverProps {
  grid_code: string;
  landcover_class: number;
  landcover_label: string;
  landcover_tree_share: number | null;
  provenance: Provenance;
}

// GET /risk-zones/{id}/rainfall
export interface RainfallObservation {
  period_start: string;
  period_end: string;
  rainfall_mm: number;
  provenance: Provenance;
  source: string;
}
export interface RainfallForecastPoint {
  issue_time: string;
  valid_start: string;
  valid_end: string;
  lead_time_h: number;
  rainfall_mm: number;
  provenance: Provenance;
  source: string;
}
export interface RainfallSeries {
  risk_zone_id: string;
  run_mode: RunMode;
  as_of: string | null;
  observed: RainfallObservation[];
  forecast: RainfallForecastPoint[];
}

// §5.14 sensor stations
export interface SensorStationProps {
  station_code: string;
  name: string;
  station_type: "VIRTUAL" | "PHYSICAL";
  status: string;
  latest_reading: { variable: string; value: number; unit: string; observed_at: string } | null;
  provenance: Provenance;
}

// §5.14 reports
export interface ReportMediaRef {
  id: string;
  media_type: "PHOTO" | "VIDEO";
  upload_status: string;
}
export interface Report {
  id: string;
  client_report_id: string;
  reporter_role: Role;
  reporter_name: string | null;
  category: string;
  severity: Severity;
  description: string | null;
  language: string;
  location: { type: "Point"; coordinates: Position };
  gps_accuracy_m: number | null;
  location_adjusted_manually: boolean;
  captured_at: string;
  submitted_at: string;
  verification_status: VerificationStatus;
  verified_by: unknown;
  verified_at: string | null;
  verification_note: string | null;
  risk_zone_id: string | null;
  road_segment_id: string | null;
  alert_id: string | null;
  media: ReportMediaRef[];
  media_expected: number;
  provenance: Provenance;
}
export interface ReportsResponse {
  items: Report[];
  next_cursor: string | null;
}
export interface MediaUrl {
  id: string;
  media_type: "PHOTO" | "VIDEO";
  mime_type: string;
  url: string;
  expires_at: string;
}

// §5.8 verify
export interface VerifyRequest {
  decision: "VERIFIED" | "REJECTED";
  note: string;
}
export interface VerifyResponse {
  id: string;
  verification_status: VerificationStatus;
  effects?: {
    road_segment?: { id: string; status: RoadStatus } | null;
    villages_access_at_risk?: number;
    priority_recomputed?: boolean;
  } | null;
}

// §5.9 / §5.14 alerts
export interface Alert {
  id: string;
  tier: AlertTier;
  status: AlertStatus;
  trigger_type: string;
  severity: Severity;
  lead_time_h: number;
  risk_zone_ids: string[];
  explanation_snapshot: { label: string; text: string }[];
  languages: string[];
  dispatched_at: string | null;
  approved_by: { id: string; full_name: string } | null;
  approved_at?: string | null;
  run_mode: RunMode;
  provenance: Provenance;
  is_demo: boolean;
  // api.md §5.14 names these fields without defining their shape.
  messages?: unknown;
  recommended_actions?: string | null;
  valid_until?: string | null;
}
export interface AlertsResponse {
  items: Alert[];
}
export type AlertChannel = "APP_PUSH" | "APP_INBOX" | "SMS";
export interface ApproveRequest {
  languages: string[];
  channels: AlertChannel[];
  recommended_actions?: string;
  valid_until?: string;
}
export interface ApproveResponse {
  id: string;
  tier: AlertTier;
  status: AlertStatus;
  approved_by: { id: string; full_name: string } | null;
  approved_at: string | null;
  dispatched_at: string | null;
  delivery_summary: Record<string, Partial<Record<DeliveryStatus, number>>>;
}
export interface AlertPatch {
  recommended_actions?: string;
  valid_until?: string;
  languages?: string[];
}

// §5.11 deliveries
export interface Delivery {
  recipient: string;
  channel: AlertChannel | string;
  channel_mode: "LIVE" | "SANDBOX";
  language: string;
  destination_masked?: string | null;
  status: DeliveryStatus;
  rendered_text?: string | null;
  queued_at?: string | null;
  sent_at?: string | null;
  acknowledged_at?: string | null;
}
export interface DeliveriesResponse {
  items: Delivery[];
}

// §5.12 priorities
export interface PriorityItem {
  rank: number;
  priority_level: string;
  priority_score: number;
  risk_zone_id: string;
  reasons: string[];
  provenance: Provenance;
}
export interface PrioritiesResponse {
  computed_at: string;
  rule_version: string;
  run_mode: RunMode;
  items: PriorityItem[];
}

// §5.4 road override
export interface RoadOverrideRequest {
  status: RoadStatus;
  reason: string;
}
