// MOCK FIXTURES — SIMULATED_DEMO. Everything here is fictional.
// Shapes follow docs/api.md examples. The area is "Mock Area — not a real location": the bbox reuses
// the illustrative api.md example coordinates only so the shapes match; no assessment of any real place.
// No record here is real-world data, and no connection status is CONNECTED_LIVE (CLAUDE.md §9.8).
import type {
  ActiveModel,
  Alert,
  DataSource,
  Delivery,
  Feature,
  HistoricalLandslideProps,
  LocationProps,
  Pilot,
  Report,
  RoadSegmentProps,
  SatelliteLayer,
  SensorStationProps,
  Severity,
  User,
} from "../api/types";

export const MOCK_PASSWORD = "mock";
export const MOCK_AREA_NAME = "Mock Area — not a real location";
export const MOCK_ISSUE_TIME = "2026-07-14T06:00:00Z";
export const MOCK_MODEL_VERSION = "mock-fixture (no model)";
export const MOCK_DISCLAIMER = "Decision-support risk estimate. Not an official warning.";

export const MOCK_USERS: User[] = [
  { id: "00000000-0000-4000-8000-00000000a001", full_name: "Mock Admin", email: "admin.mock@example.org", role: "ADMIN", preferred_language: "en", admin_boundary_id: "00000000-0000-4000-8000-00000000d001", is_demo_account: true },
  { id: "00000000-0000-4000-8000-00000000a002", full_name: "Mock District Authority", email: "authority.mock@example.org", role: "DISTRICT_AUTHORITY", preferred_language: "en", admin_boundary_id: "00000000-0000-4000-8000-00000000d001", is_demo_account: true },
  { id: "00000000-0000-4000-8000-00000000a003", full_name: "Mock Field Officer", email: "field.mock@example.org", role: "FIELD_OFFICER", preferred_language: "en", admin_boundary_id: "00000000-0000-4000-8000-00000000d001", is_demo_account: true },
];

const BBOX: [number, number, number, number] = [91.7, 25.5, 91.95, 25.7];

export const MOCK_PILOT: Pilot = {
  slug: "mock-area",
  name: MOCK_AREA_NAME,
  status: "PROVISIONAL",
  bbox: BBOX,
  cell_size_m: 1000,
  boundary: {
    type: "Polygon",
    coordinates: [[[BBOX[0], BBOX[1]], [BBOX[2], BBOX[1]], [BBOX[2], BBOX[3]], [BBOX[0], BBOX[3]], [BBOX[0], BBOX[1]]]],
  },
  boundary_note: "Mock bounding box — not an official administrative boundary",
};

/** The seven display labels and their meanings, mirrored from the API contract for mock mode. */
export const MOCK_LABELS = {
  REAL_LIVE: "Connected to a real source now; freshness shown",
  REAL_REPLAY: "Real archived data replayed through the system for the demo",
  REAL_HISTORICAL: "Real archived data from a documented source",
  SIMULATED: "Synthetic data created by the team; never used for training or metrics",
  SANDBOX: "Rendered and logged, not sent",
  AWAITING_ACCESS: "Adapter exists; access requested, not granted",
  NOT_CONNECTED: "Adapter exists; nothing connected",
} as const;

export const MOCK_MODEL: ActiveModel = {
  version: "mock-fixture (no model)",
  model_type: "MOCK_FIXTURE",
  stage: "MOCK",
  validation_scheme: "NONE — mock fixture, nothing trained or validated",
  thresholds: { calibrated: false, note: "Mock cut-offs only; the real thresholds are pending approval (H11)." },
  metrics: null,
  forecast_skill_evaluated: false,
  model_card_uri: null,
};

export const MOCK_DATA_SOURCES: DataSource[] = [
  { slug: "mock-terrain", kind: "TERRAIN", provider: "Mock fixture (fictional)", dataset: "Mock slope/relief grid", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO", status_note: "MOCK FIXTURE: no real terrain data" },
  { slug: "mock-inventory", kind: "INVENTORY", provider: "Mock fixture (fictional)", dataset: "Mock landslide records", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO", status_note: "MOCK FIXTURE: fictional records, no dates" },
  { slug: "mock-roads", kind: "EXPOSURE", provider: "Mock fixture (fictional)", dataset: "Mock road segments", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO" },
  { slug: "mock-places", kind: "EXPOSURE", provider: "Mock fixture (fictional)", dataset: "Mock villages and facilities", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO" },
  { slug: "imd-gridded-rainfall", kind: "WEATHER_HISTORICAL", provider: "Mock fixture standing in for the IMD gridded rainfall record", connection_status: "CONNECTED_HISTORICAL", provenance_default: "SIMULATED_DEMO", verification_status: "VERIFIED", last_success_at: "2026-07-14T05:00:00Z", attribution_text: "Mock fixture — no attribution recorded", licence: "MOCK FIXTURE: no licence; mock mode never uses real IMD data", status_note: "MOCK FIXTURE: status shape only, no data loaded" },
  { slug: "imd-weather-api", kind: "WEATHER_LIVE", connection_status: "AWAITING_ACCESS", last_success_at: null, status_note: "MOCK FIXTURE: No live IMD data in use." },
  { slug: "imerg-feed", kind: "SATELLITE_FEED", connection_status: "NOT_CONNECTED", last_success_at: null, status_note: null },
  { slug: "sentinel2-composite", kind: "SATELLITE_LAYER", connection_status: "CONNECTED_HISTORICAL", status_note: "MOCK FIXTURE: no imagery loaded", metadata: { acquisition_start: "2026-01-01", acquisition_end: "2026-02-28" } },
  { slug: "replay-forecast", kind: "WEATHER_FORECAST", provider: "Mock replay", dataset: "Mock stand-in forecast", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO", status_note: "Mock stand-in; not a weather forecast" },
  { slug: "virtual-soil-moisture", kind: "SENSOR", connection_status: "SIMULATED", provenance_default: "SIMULATED_DEMO", status_note: "Virtual stations posting through the sensor ingestion API (mock)" },
  { slug: "sensor-gateway", kind: "SENSOR", connection_status: "NOT_CONNECTED" },
  // The in-app inbox is the only channel that is genuinely live in mock mode: it is the app itself.
  { slug: "app-inbox-channel", kind: "NOTIFICATION_CHANNEL", provider: "GeoRakshak", dataset: "In-app inbox", connection_status: "CONNECTED_LIVE", last_success_at: "2026-07-14T06:05:02Z", status_note: "In-app inbox (mock): deliveries are written to the mock inbox" },
  { slug: "app-push-channel", kind: "NOTIFICATION_CHANNEL", provider: "Firebase Cloud Messaging", dataset: "FCM push", connection_status: "NOT_CONNECTED", status_note: "MOCK FIXTURE: no push provider in mock mode" },
  { slug: "sms-channel", kind: "NOTIFICATION_CHANNEL", connection_status: "SANDBOX", status_note: "Messages rendered and logged, not sent" },
];

// Featured cell used by the storyline (reports, alerts, priorities point at it).
export const FEATURED_CELL_ID = "00000000-0000-4000-8000-00000000c412";
export const MOCK_ROAD_ID = "00000000-0000-4000-8000-00000000b012";

const CELL_DEG = 0.01;
const HOTSPOT: [number, number] = [91.805, 25.605];

export interface MockCell {
  id: string;
  gridCode: string;
  ring: [number, number][];
  baseScore: number;
}

/** Deterministic fictional grid: score falls off with distance from a fictional hotspot. */
export function buildMockCells(): MockCell[] {
  const cells: MockCell[] = [];
  const cols = Math.round((BBOX[2] - BBOX[0]) / CELL_DEG);
  const rows = Math.round((BBOX[3] - BBOX[1]) / CELL_DEG);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = +(BBOX[0] + c * CELL_DEG).toFixed(4);
      const y0 = +(BBOX[1] + r * CELL_DEG).toFixed(4);
      const x1 = +(x0 + CELL_DEG).toFixed(4);
      const y1 = +(y0 + CELL_DEG).toFixed(4);
      const cx = x0 + CELL_DEG / 2;
      const cy = y0 + CELL_DEG / 2;
      const d = Math.hypot(cx - HOTSPOT[0], cy - HOTSPOT[1]);
      const ridge = 0.08 * Math.sin(c * 0.9) * Math.cos(r * 0.7);
      const baseScore = Math.max(0.03, Math.min(0.95, 0.8 - d * 6 + ridge));
      const featured = x0 === 91.8 && y0 === 25.6;
      const n = String(r * cols + c).padStart(4, "0");
      cells.push({
        id: featured ? FEATURED_CELL_ID : `00000000-0000-4000-8000-0000000c${n}`,
        gridCode: `MOCK-${String(r).padStart(4, "0")}-${String(c).padStart(4, "0")}`,
        ring: [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]],
        baseScore,
      });
    }
  }
  return cells;
}

/** Mock-only cut-offs. The real severity thresholds are PENDING HUMAN APPROVAL (H11). */
export function mockSeverity(score: number): Severity {
  if (score >= 0.75) return "VERY_HIGH";
  if (score >= 0.55) return "HIGH";
  if (score >= 0.3) return "MODERATE";
  return "LOW";
}

export const MOCK_LOCATIONS: Feature<LocationProps>[] = [
  { type: "Feature", id: "00000000-0000-4000-8000-00000000e001", geometry: { type: "Point", coordinates: [91.812, 25.611] }, properties: { type: "VILLAGE", name: "Mock Village A (fictional)", access_status: "OK", population: null, population_source_year: null, source_slug: "mock-fixture", provenance: "SIMULATED_DEMO" } },
  { type: "Feature", id: "00000000-0000-4000-8000-00000000e002", geometry: { type: "Point", coordinates: [91.823, 25.596] }, properties: { type: "VILLAGE", name: "Mock Village B (fictional)", access_status: "OK", population: null, population_source_year: null, source_slug: "mock-fixture", provenance: "SIMULATED_DEMO" } },
  { type: "Feature", id: "00000000-0000-4000-8000-00000000e003", geometry: { type: "Point", coordinates: [91.78, 25.62] }, properties: { type: "SCHOOL", name: "Mock School (fictional)", access_status: null, population: null, population_source_year: null, source_slug: "mock-fixture", provenance: "SIMULATED_DEMO" } },
  { type: "Feature", id: "00000000-0000-4000-8000-00000000e004", geometry: { type: "Point", coordinates: [91.83, 25.615] }, properties: { type: "HEALTH_FACILITY", name: "Mock Health Centre (fictional)", access_status: null, population: null, population_source_year: null, source_slug: "mock-fixture", provenance: "SIMULATED_DEMO" } },
];

export const MOCK_LANDSLIDES: Feature<HistoricalLandslideProps>[] = [
  { type: "Feature", id: "00000000-0000-4000-8000-00000000f001", geometry: { type: "Point", coordinates: [91.797, 25.607] }, properties: { event_date: null, event_date_precision: "UNKNOWN", trigger: "Mock (fictional record)", landslide_type: null, location_accuracy_m: null, source_slug: "mock-fixture", provenance: "SIMULATED_DEMO" } },
  { type: "Feature", id: "00000000-0000-4000-8000-00000000f002", geometry: { type: "Point", coordinates: [91.842, 25.588] }, properties: { event_date: null, event_date_precision: "UNKNOWN", trigger: "Mock (fictional record)", landslide_type: null, location_accuracy_m: null, source_slug: "mock-fixture", provenance: "SIMULATED_DEMO" } },
];

export function buildMockRoads(): Feature<RoadSegmentProps>[] {
  const base = { status_source: "MOCK_RULE", status_report_id: null, status_updated_at: MOCK_ISSUE_TIME, villages_access_at_risk: 0, provenance: "SIMULATED_DEMO" as const };
  return [
    { type: "Feature", id: MOCK_ROAD_ID, geometry: { type: "LineString", coordinates: [[91.78, 25.585], [91.801, 25.598], [91.806, 25.603], [91.815, 25.61]] }, properties: { ...base, name: "Mock Road 1 (fictional)", road_class: "secondary", status: "AT_RISK", status_reason: "Mock: segment passes through a High cell", villages_access_at_risk: 2 } },
    { type: "Feature", id: "00000000-0000-4000-8000-00000000b013", geometry: { type: "LineString", coordinates: [[91.815, 25.61], [91.83, 25.615], [91.86, 25.63]] }, properties: { ...base, name: "Mock Road 2 (fictional)", road_class: "tertiary", status: "OPEN", status_reason: null } },
    { type: "Feature", id: "00000000-0000-4000-8000-00000000b014", geometry: { type: "LineString", coordinates: [[91.72, 25.66], [91.76, 25.64], [91.78, 25.62]] }, properties: { ...base, name: "Mock Road 3 (fictional)", road_class: "track", status: "UNKNOWN", status_reason: "Mock: no information" } },
  ];
}

export function buildMockStations(step: number): Feature<SensorStationProps>[] {
  const vwc = (b: number) => +(Math.min(0.55, b + step * 0.02)).toFixed(2);
  return [
    { type: "Feature", id: "00000000-0000-4000-8000-000000005001", geometry: { type: "Point", coordinates: [91.795, 25.612] }, properties: { station_code: "VS-01", name: "Mock virtual station 1", station_type: "VIRTUAL", status: "ACTIVE", latest_reading: { variable: "SOIL_MOISTURE_VWC", value: vwc(0.28), unit: "m3/m3", observed_at: MOCK_ISSUE_TIME }, provenance: "SIMULATED_DEMO" } },
    { type: "Feature", id: "00000000-0000-4000-8000-000000005002", geometry: { type: "Point", coordinates: [91.808, 25.599] }, properties: { station_code: "VS-02", name: "Mock virtual station 2", station_type: "VIRTUAL", status: "ACTIVE", latest_reading: { variable: "SOIL_MOISTURE_VWC", value: vwc(0.36), unit: "m3/m3", observed_at: MOCK_ISSUE_TIME }, provenance: "SIMULATED_DEMO" } },
  ];
}

export const MOCK_SATELLITE: SatelliteLayer[] = [
  { slug: "mock-ndvi", title: "Mock vegetation layer (no imagery)", kind: "NDVI", acquisition_start: "2026-01-01", acquisition_end: "2026-02-28", bounds: BBOX, display: null, attribution_text: "Mock fixture", provenance: "SIMULATED_DEMO" },
];

const MOCK_PHOTO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#d9d4c7"/><text x="240" y="140" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#333">MOCK PHOTO</text><text x="240" y="175" font-family="sans-serif" font-size="14" text-anchor="middle" fill="#333">Simulated placeholder — not a real event</text></svg>`;
export const MOCK_PHOTO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MOCK_PHOTO_SVG)}`;

export function buildMockReports(): Report[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000002021", client_report_id: "0c8e6f0a-4d2b-4b8e-9b1e-3f1b2a7c9d10", reporter_role: "FIELD_OFFICER", reporter_name: "Mock Field Officer",
      category: "ROAD_BLOCKED", severity: "HIGH", description: "Mock report: debris across the road below the slope (fictional).", language: "en",
      location: { type: "Point", coordinates: [91.8043, 25.6011] }, gps_accuracy_m: 8, location_adjusted_manually: false,
      captured_at: "2026-07-14T06:41:00Z", submitted_at: "2026-07-14T06:41:30Z", verification_status: "UNVERIFIED", verified_by: null, verified_at: null, verification_note: null,
      risk_zone_id: FEATURED_CELL_ID, road_segment_id: MOCK_ROAD_ID, alert_id: null,
      media: [ { id: "00000000-0000-4000-8000-000000007040", media_type: "PHOTO", upload_status: "UPLOADED" }, { id: "00000000-0000-4000-8000-000000007041", media_type: "VIDEO", upload_status: "PENDING" } ],
      media_expected: 2, provenance: "SIMULATED_DEMO",
    },
    {
      id: "00000000-0000-4000-8000-000000002022", client_report_id: "7a1d2c3b-0000-4000-8000-000000000022", reporter_role: "CITIZEN", reporter_name: "Mock Citizen",
      category: "CRACK", severity: "MODERATE", description: "Mock report: new crack on the slope above the path (fictional).", language: "en",
      location: { type: "Point", coordinates: [91.815, 25.612] }, gps_accuracy_m: 25, location_adjusted_manually: true,
      captured_at: "2026-07-14T06:30:00Z", submitted_at: "2026-07-14T06:35:00Z", verification_status: "UNVERIFIED", verified_by: null, verified_at: null, verification_note: null,
      risk_zone_id: null, road_segment_id: null, alert_id: null, media: [], media_expected: 0, provenance: "SIMULATED_DEMO",
    },
  ];
}

export function buildMockAlerts(): Alert[] {
  const common = { lead_time_h: 0, risk_zone_ids: [FEATURED_CELL_ID], languages: ["en", "hi"], run_mode: "DEMO_REPLAY" as const, provenance: "SIMULATED_DEMO" as const, is_demo: true };
  return [
    { ...common, id: "00000000-0000-4000-8000-000000009055", tier: "WATCH", status: "AUTO_DISPATCHED", trigger_type: "AUTOMATIC_THRESHOLD", severity: "HIGH", explanation_snapshot: [{ label: "3-day rainfall", text: "Mock: far above usual (fictional)" }], dispatched_at: "2026-07-14T06:05:02Z", approved_by: null },
    { ...common, id: "00000000-0000-4000-8000-000000009060", tier: "WARNING", status: "DRAFT", trigger_type: "AUTOMATIC_THRESHOLD", severity: "VERY_HIGH", explanation_snapshot: [{ label: "3-day rainfall", text: "Mock: far above usual (fictional)" }, { label: "Slope", text: "Mock: very steep" }], dispatched_at: null, approved_by: null, recommended_actions: "Avoid the road below the slope. Follow instructions from local authorities.", valid_until: "2026-07-15T06:00:00Z" },
  ];
}

export function buildMockDeliveries(languages: string[], channels: string[]): Delivery[] {
  // Mock mode never sends anything, so every delivery is SANDBOXED.
  return channels.flatMap((channel) =>
    languages.map((language) => ({
      recipient: "Mock Citizen",
      channel,
      channel_mode: "SANDBOX" as const,
      language,
      destination_masked: channel === "SMS" ? "+91******0000" : null,
      status: "SANDBOXED" as const,
      rendered_text: `[MOCK ${language}] Landslide risk warning (simulated). Avoid the road below the slope.`,
      queued_at: new Date().toISOString(),
    })),
  );
}
