// In-memory mock implementation of ApiClient (VITE_API_MODE=mock). No network access.
// All data is fictional SIMULATED_DEMO (see mock-fixtures_simulated.ts).
import type { ApiClient, ClientOptions } from "../api/client";
import { ApiError } from "../api/errors";
import type {
  AdapterGroupKey,
  Alert,
  EffectiveLabel,
  StatusAdapter,
  Delivery,
  Factor,
  Feature,
  LeadTime,
  Report,
  RiskZoneCollection,
  RiskZoneDetail,
  RoadSegmentProps,
  Severity,
} from "../api/types";
import {
  FEATURED_CELL_ID,
  MOCK_DATA_SOURCES,
  MOCK_DISCLAIMER,
  MOCK_ISSUE_TIME,
  MOCK_LABELS,
  MOCK_LANDSLIDES,
  MOCK_LOCATIONS,
  MOCK_MODEL,
  MOCK_MODEL_VERSION,
  MOCK_PASSWORD,
  MOCK_PHOTO_URL,
  MOCK_PILOT,
  MOCK_SATELLITE,
  MOCK_USERS,
  buildMockAlerts,
  buildMockCells,
  buildMockDeliveries,
  buildMockReports,
  buildMockRoads,
  buildMockStations,
  mockSeverity,
  type MockCell,
} from "./mock-fixtures_simulated";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const addHours = (iso: string, h: number) => new Date(new Date(iso).getTime() + h * 3600_000).toISOString().replace(".000Z", "Z");
const AUTHORITY_ROLES = new Set(["ADMIN", "STATE_AUTHORITY", "DISTRICT_AUTHORITY"]);

interface MockState {
  step: number;
  replayRunning: boolean;
  cells: MockCell[];
  roads: Feature<RoadSegmentProps>[];
  reports: Report[];
  alerts: Alert[];
  deliveries: Record<string, Delivery[]>;
}

function freshState(): MockState {
  return { step: 0, replayRunning: false, cells: buildMockCells(), roads: buildMockRoads(), reports: buildMockReports(), alerts: buildMockAlerts(), deliveries: {} };
}

export function createMockClient(opts: ClientOptions): ApiClient {
  let state = freshState();
  const tokens = new Map<string, (typeof MOCK_USERS)[number]>();

  async function authed(requireAuthority = false) {
    await tick();
    const token = opts.getToken();
    const user = token ? tokens.get(token) : undefined;
    if (!user) {
      opts.onUnauthenticated();
      throw new ApiError(401, "UNAUTHENTICATED", "Session expired or invalid. Please log in again.");
    }
    if (requireAuthority && !AUTHORITY_ROLES.has(user.role)) {
      throw new ApiError(403, "FORBIDDEN", "This action needs an authority role.");
    }
    return user;
  }

  const scoreOf = (cell: MockCell, lt: LeadTime) => Math.min(0.97, cell.baseScore + state.step * 0.02 + (lt / 24) * 0.04);

  const findAlert = (id: string) => {
    const a = state.alerts.find((x) => x.id === id);
    if (!a) throw new ApiError(404, "NOT_FOUND", "Alert not found");
    return a;
  };

  function factorsFor(score: number): Factor[] {
    const s = (t: string) => `${t} (mock value, fictional)`;
    return [
      { feature: "rain_3d_mm", label: "3-day rainfall", value: +(120 + state.step * 8).toFixed(1), unit: "mm", contribution: +(score * 0.3).toFixed(2), direction: "increases_risk", component: "TRIGGER", text: s("3-day rainfall is far above this area's usual level"), provenance: "SIMULATED_DEMO" },
      { feature: "slope_deg_mean", label: "Slope", value: 38.5, unit: "deg", contribution: +(score * 0.24).toFixed(2), direction: "increases_risk", component: "SUSCEPTIBILITY", text: s("Very steep slope"), provenance: "SIMULATED_DEMO" },
      { feature: "ndvi_mean", label: "Vegetation (satellite)", value: 0.31, unit: null, contribution: +(score * 0.1).toFixed(2), direction: "increases_risk", component: "SUSCEPTIBILITY", text: s("Sparse vegetation cover (mock layer, 2026-01-01 to 2026-02-28)"), provenance: "SIMULATED_DEMO" },
      { feature: "dist_road_m", label: "Distance to road", value: 850, unit: "m", contribution: 0.03, direction: "decreases_risk", component: "SUSCEPTIBILITY", text: s("No road cut directly on this slope"), provenance: "SIMULATED_DEMO" },
      { feature: "sensor_vwc", label: "Soil moisture sensor", value: +(0.36 + state.step * 0.02).toFixed(2), unit: "m3/m3", contribution: 0.06, direction: "increases_risk", component: "SENSOR_ADJUSTMENT", text: s("Nearby soil moisture reading is high (virtual sensor, simulated)"), provenance: "SIMULATED_DEMO", station_code: "VS-02" },
    ];
  }

  function summaryCounts() {
    const risk: Record<Severity, number> = { LOW: 0, MODERATE: 0, HIGH: 0, VERY_HIGH: 0 };
    state.cells.forEach((c) => (risk[mockSeverity(scoreOf(c, 0))] += 1));
    const alerts = { DRAFT: 0, AUTO_DISPATCHED: 0, DISPATCHED: 0 };
    state.alerts.forEach((a) => {
      if (a.status in alerts) alerts[a.status as keyof typeof alerts] += 1;
    });
    const reports = { UNVERIFIED: 0, VERIFIED: 0, REJECTED: 0 };
    state.reports.forEach((r) => (reports[r.verification_status] += 1));
    const roads = { OPEN: 0, AT_RISK: 0, BLOCKED: 0, UNKNOWN: 0 };
    state.roads.forEach((r) => (roads[r.properties.status] += 1));
    return { risk, alerts, reports, roads };
  }

  return {
    mode: "mock",

    async login(email, password) {
      await tick();
      const user = MOCK_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user || password !== MOCK_PASSWORD) throw new ApiError(401, "UNAUTHENTICATED", "Invalid email or password");
      const token = `mock-token-${user.id}-${Date.now()}`;
      tokens.set(token, user);
      return { access_token: token, token_type: "bearer", expires_in: 3600, user: clone(user) };
    },
    async me() {
      return clone(await authed());
    },
    async systemMode() {
      await tick();
      return {
        run_mode: "DEMO_REPLAY",
        monitor: {
          enabled: false,
          interval_s: null,
          weather_provider: "none",
          last_run_at: null,
          last_status: null,
          last_error: null,
          next_run_at: null,
          result: null,
          weather: null,
          weather_error: null,
          note: "Mock DEMO_REPLAY: cycles run on replay steps, not on a timer",
        },
        replay: state.replayRunning
          ? { scenario: "Mock scenario (simulated)", provenance: "SIMULATED_DEMO", step: state.step, steps: 12, as_of: addHours(MOCK_ISSUE_TIME, state.step * 24) }
          : null,
      };
    },
    async systemStatus() {
      await authed();
      const mode = await this.systemMode();
      const groupOf = (kind: string): AdapterGroupKey =>
        kind.startsWith("WEATHER") ? "weather" : kind.startsWith("SATELLITE") ? "satellite" : kind === "SENSOR" ? "sensor" : kind === "INVENTORY" ? "inventory" : kind === "TERRAIN" ? "terrain" : kind === "EXPOSURE" ? "exposure" : kind === "NOTIFICATION_CHANNEL" ? "notification" : "other";
      // Mock rows are fixtures: nothing is REAL_LIVE except the in-app inbox, which is the app itself.
      const labelOf = (s: (typeof MOCK_DATA_SOURCES)[number]): EffectiveLabel => {
        if (s.slug === "app-inbox-channel") return "REAL_LIVE";
        if (s.connection_status === "SANDBOX") return "SANDBOX";
        if (s.connection_status === "AWAITING_ACCESS") return "AWAITING_ACCESS";
        if (s.connection_status === "NOT_CONNECTED") return "NOT_CONNECTED";
        return "SIMULATED";
      };
      const adapters: Partial<Record<AdapterGroupKey, StatusAdapter[]>> = {};
      const counts: Partial<Record<EffectiveLabel, number>> = {};
      for (const s of MOCK_DATA_SOURCES) {
        const effective_label = labelOf(s);
        const age_s = s.last_success_at ? Math.max(0, Math.round((Date.now() - new Date(s.last_success_at).getTime()) / 1000)) : null;
        const row: StatusAdapter = { ...clone(s), effective_label, age_s, is_imd: /imd/i.test(s.slug), verification_status: s.verification_status ?? "UNVERIFIED", provenance_default: s.provenance_default ?? null, last_error: null };
        (adapters[groupOf(s.kind)] ??= []).push(row);
        counts[effective_label] = (counts[effective_label] ?? 0) + 1;
      }
      return {
        run_mode: mode.run_mode,
        replay: mode.replay ?? null,
        monitor: mode.monitor ?? null,
        pilot: { slug: MOCK_PILOT.slug, name: MOCK_PILOT.name, status: MOCK_PILOT.status },
        model: { version: MOCK_MODEL.version, model_type: MOCK_MODEL.model_type, stage: MOCK_MODEL.stage, calibrated: false, validated: false, metrics: null, validation_scheme: MOCK_MODEL.validation_scheme, forecast_skill_evaluated: false, model_card_uri: null },
        adapters,
        label_counts: counts,
        labels: { ...MOCK_LABELS },
        disclaimer: MOCK_DISCLAIMER,
        as_of: new Date().toISOString(),
      };
    },
    async activeModel() {
      await authed(true);
      return clone(MOCK_MODEL);
    },
    async pilot() {
      await authed();
      return clone(MOCK_PILOT);
    },
    async dataSources() {
      await authed(true);
      return { run_mode: "DEMO_REPLAY", items: clone(MOCK_DATA_SOURCES) };
    },
    async dashboardSummary() {
      await authed(true);
      const c = summaryCounts();
      return { run_mode: "DEMO_REPLAY", risk_zone_counts: c.risk, alerts: c.alerts, reports: c.reports, road_segments: c.roads, as_of: addHours(MOCK_ISSUE_TIME, state.step) };
    },
    async riskZones(_bbox, lt): Promise<RiskZoneCollection> {
      await authed();
      return {
        type: "FeatureCollection",
        metadata: {
          run_mode: "DEMO_REPLAY",
          lead_time_h: lt,
          issue_time: MOCK_ISSUE_TIME,
          valid_from: addHours(MOCK_ISSUE_TIME, lt),
          valid_until: addHours(MOCK_ISSUE_TIME, lt + 24),
          model_version: MOCK_MODEL_VERSION,
          forecast_source: lt === 0 ? null : { slug: "replay-forecast", label: "Mock forecast (simulated)", connection_status: "SIMULATED" as const },
          input_provenance: ["SIMULATED_DEMO"],
          provenance: "SIMULATED_DEMO",
          forecast_skill_evaluated: false,
          disclaimer: MOCK_DISCLAIMER,
        },
        features: state.cells.map((c) => {
          const score = +scoreOf(c, lt).toFixed(2);
          return { type: "Feature", id: c.id, geometry: { type: "Polygon", coordinates: [c.ring] }, properties: { grid_code: c.gridCode, severity: mockSeverity(score), score, confidence: "LOW" } };
        }),
      };
    },
    async riskZone(id, lt): Promise<RiskZoneDetail> {
      await authed();
      const cell = state.cells.find((c) => c.id === id);
      if (!cell) throw new ApiError(404, "NOT_FOUND", "Risk zone not found");
      const score = +scoreOf(cell, lt).toFixed(2);
      return {
        id: cell.id,
        grid_code: cell.gridCode,
        admin_boundary: { id: "00000000-0000-4000-8000-00000000d001", name: "Mock District (fictional)" },
        assessment: { id: `ra-${cell.id}`, lead_time_h: lt, score, severity: mockSeverity(score), confidence: "LOW", model_version: MOCK_MODEL_VERSION, issue_time: MOCK_ISSUE_TIME, run_mode: "DEMO_REPLAY", provenance: "SIMULATED_DEMO", factors: factorsFor(score) },
        exposure: id === FEATURED_CELL_ID ? { villages: 2, schools: 1, health_facilities: 1, road_segments_at_risk: 1 } : { villages: 0, schools: 0, health_facilities: 0, road_segments_at_risk: 0 },
        open_alerts: state.alerts.filter((a) => a.risk_zone_ids.includes(id) && !["CLOSED", "REJECTED"].includes(a.status)).map((a) => ({ id: a.id, tier: a.tier, status: a.status })),
        disclaimer: MOCK_DISCLAIMER,
      };
    },
    async locations() {
      await authed();
      return { type: "FeatureCollection", metadata: { provenance: "SIMULATED_DEMO", attribution: "Mock fixture" }, features: clone(MOCK_LOCATIONS) };
    },
    async historicalLandslides() {
      await authed();
      return { type: "FeatureCollection", metadata: { provenance: "SIMULATED_DEMO", attribution: "Mock fixture" }, features: clone(MOCK_LANDSLIDES) };
    },
    async landcover() {
      await authed();
      // One fictional majority class per mock cell, derived deterministically from the cell index.
      const labels: Record<number, string> = { 10: "Tree cover", 30: "Grassland", 50: "Built-up" };
      return {
        type: "FeatureCollection" as const,
        metadata: {
          source_slug: "mock-landcover",
          dataset: "Mock land-cover classes (fictional)",
          connection_status: "SIMULATED" as const,
          acquisition_start: "2026-01-01",
          acquisition_end: "2026-02-28",
          acquisition_note: null,
          attribution: "Mock fixture",
          provenance: "SIMULATED_DEMO" as const,
          class_labels: { "10": "Tree cover", "30": "Grassland", "50": "Built-up" },
          note: "Majority land-cover class per analysis cell (mock). Not an image.",
        },
        features: state.cells.map((c, i) => {
          const cls = i % 17 === 0 ? 50 : i % 7 === 0 ? 30 : 10;
          return {
            type: "Feature" as const,
            id: c.id,
            geometry: { type: "Polygon" as const, coordinates: [c.ring] },
            properties: { grid_code: c.gridCode, landcover_class: cls, landcover_label: labels[cls], landcover_tree_share: cls === 10 ? 0.87 : 0.12, provenance: "SIMULATED_DEMO" as const },
          };
        }),
      };
    },
    async zoneRainfall(id) {
      await authed(true);
      const cell = state.cells.find((c) => c.id === id);
      if (!cell) throw new ApiError(404, "NOT_FOUND", "Risk zone not found");
      const day = (n: number) => addHours(MOCK_ISSUE_TIME, (n - 15) * 24);
      const observed = Array.from({ length: 15 }, (_, i) => ({
        period_start: day(i),
        period_end: day(i + 1),
        rainfall_mm: +(8 + ((i * 7 + state.step * 3) % 40) + (i === 14 ? 60 : 0)).toFixed(1),
        provenance: "SIMULATED_DEMO" as const,
        source: "mock-rainfall",
      }));
      const forecast = [24, 48, 72].map((lead, i) => ({
        issue_time: MOCK_ISSUE_TIME,
        valid_start: addHours(MOCK_ISSUE_TIME, lead - 24),
        valid_end: addHours(MOCK_ISSUE_TIME, lead),
        lead_time_h: lead,
        rainfall_mm: +(20 - i * 6).toFixed(1),
        provenance: "SIMULATED_DEMO" as const,
        source: "mock-forecast",
      }));
      return { risk_zone_id: id, run_mode: "DEMO_REPLAY" as const, as_of: MOCK_ISSUE_TIME, observed, forecast };
    },
    async satelliteLayers() {
      await authed();
      return { items: clone(MOCK_SATELLITE) };
    },
    async roadSegments() {
      await authed();
      return { type: "FeatureCollection", metadata: { run_mode: "DEMO_REPLAY", status_semantics: "OPEN means no evidence of blockage, not confirmed passable", attribution: "Mock fixture" }, features: clone(state.roads) };
    },
    async overrideRoadStatus(id, body) {
      await authed(true);
      const road = state.roads.find((r) => r.id === id);
      if (!road) throw new ApiError(404, "NOT_FOUND", "Road segment not found");
      if (!body.reason.trim()) throw new ApiError(422, "VALIDATION_ERROR", "reason is required", [{ field: "reason", issue: "must not be empty" }]);
      road.properties = { ...road.properties, status: body.status, status_source: "AUTHORITY_OVERRIDE", status_reason: body.reason, status_updated_at: new Date().toISOString() };
      return clone(road);
    },
    async sensorStations() {
      await authed();
      return { type: "FeatureCollection", metadata: { provenance: "SIMULATED_DEMO" }, features: buildMockStations(state.step) };
    },
    async reports() {
      await authed(true);
      return { items: clone(state.reports), next_cursor: null };
    },
    async report(id) {
      await authed(true);
      const r = state.reports.find((x) => x.id === id);
      if (!r) throw new ApiError(404, "NOT_FOUND", "Report not found");
      return clone(r);
    },
    async media(id) {
      await authed(true);
      const ref = state.reports.flatMap((r) => r.media).find((m) => m.id === id);
      if (!ref) throw new ApiError(404, "NOT_FOUND", "Media not found");
      if (ref.media_type !== "PHOTO") throw new ApiError(404, "NOT_FOUND", "Mock mode has no video file (upload pending)");
      return { id, media_type: "PHOTO", mime_type: "image/svg+xml", url: MOCK_PHOTO_URL, expires_at: addHours(new Date().toISOString(), 1) };
    },
    async verifyReport(id, body) {
      const user = await authed(true);
      const r = state.reports.find((x) => x.id === id);
      if (!r) throw new ApiError(404, "NOT_FOUND", "Report not found");
      if (r.verification_status !== "UNVERIFIED") throw new ApiError(409, "CONFLICT", "Report has already been reviewed");
      r.verification_status = body.decision;
      r.verification_note = body.note;
      r.verified_at = new Date().toISOString();
      r.verified_by = { id: user.id, full_name: user.full_name };
      let roadEffect: { id: string; status: "BLOCKED" } | null = null;
      if (body.decision === "VERIFIED" && r.category === "ROAD_BLOCKED" && r.road_segment_id) {
        const road = state.roads.find((x) => x.id === r.road_segment_id);
        if (road) {
          road.properties = { ...road.properties, status: "BLOCKED", status_source: "VERIFIED_REPORT", status_reason: "Verified report: road blocked (mock)", status_report_id: r.id, status_updated_at: r.verified_at };
          roadEffect = { id: road.id as string, status: "BLOCKED" };
        }
      }
      return { id, verification_status: r.verification_status, effects: { road_segment: roadEffect, villages_access_at_risk: roadEffect ? 2 : 0, priority_recomputed: body.decision === "VERIFIED" } };
    },
    async alerts() {
      await authed(true);
      return { items: clone(state.alerts) };
    },
    async patchAlert(id, body) {
      await authed(true);
      const a = findAlert(id);
      if (a.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Only DRAFT alerts can be edited");
      Object.assign(a, body);
      return clone(a);
    },
    async approveAlert(id, body) {
      const user = await authed(true);
      const a = findAlert(id);
      if (a.tier === "WATCH") throw new ApiError(409, "CONFLICT", "WATCH alerts are automatic and cannot be approved");
      if (a.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Alert is not in DRAFT");
      if (body.languages.length === 0 || body.channels.length === 0) throw new ApiError(422, "VALIDATION_ERROR", "Select at least one language and one channel");
      const now = new Date().toISOString();
      Object.assign(a, { status: "DISPATCHED", approved_by: { id: user.id, full_name: user.full_name }, approved_at: now, dispatched_at: now, languages: body.languages, recommended_actions: body.recommended_actions ?? a.recommended_actions });
      state.deliveries[id] = buildMockDeliveries(body.languages, body.channels);
      const summary: Record<string, { SANDBOXED: number }> = {};
      state.deliveries[id].forEach((d) => (summary[d.channel] = { SANDBOXED: (summary[d.channel]?.SANDBOXED ?? 0) + 1 }));
      return { id, tier: a.tier, status: a.status, approved_by: a.approved_by, approved_at: now, dispatched_at: now, delivery_summary: summary };
    },
    async rejectAlert(id) {
      await authed(true);
      const a = findAlert(id);
      if (a.status !== "DRAFT") throw new ApiError(409, "CONFLICT", "Alert is not in DRAFT");
      a.status = "REJECTED";
      return clone(a);
    },
    async closeAlert(id) {
      await authed(true);
      const a = findAlert(id);
      if (["CLOSED", "REJECTED", "DRAFT"].includes(a.status)) throw new ApiError(409, "CONFLICT", `Alert in ${a.status} cannot be closed`);
      a.status = "CLOSED";
      return clone(a);
    },
    async deliveries(alertId) {
      await authed(true);
      findAlert(alertId);
      return { items: clone(state.deliveries[alertId] ?? []) };
    },
    async responsePriorities(lt) {
      await authed(true);
      const cell = state.cells.find((c) => c.id === FEATURED_CELL_ID)!;
      const sev = mockSeverity(scoreOf(cell, lt));
      const verified = state.reports.filter((r) => r.verification_status === "VERIFIED" && r.risk_zone_id === FEATURED_CELL_ID);
      const blocked = state.roads.some((r) => r.properties.status === "BLOCKED");
      const reasons = [
        ...verified.map((r) => `Verified report: ${r.category.toLowerCase().replace(/_/g, " ")} (mock)`),
        `Risk ${sev} (mock values)`,
        blocked ? "2 mock villages with access at risk; 1 mock health facility nearby" : "2 mock villages exposed; 1 mock health facility nearby",
      ];
      return {
        computed_at: new Date().toISOString(),
        rule_version: "mock-priority-rules (fictional)",
        run_mode: "DEMO_REPLAY",
        items: [{ rank: 1, priority_level: verified.length ? "P1" : "P2", priority_score: verified.length ? 0.88 : 0.61, risk_zone_id: FEATURED_CELL_ID, reasons, provenance: "SIMULATED_DEMO" }],
      };
    },
    async demoReplayStart() {
      await authed(true);
      state.replayRunning = true;
      state.step = 0;
      return { replay: (await this.systemMode()).replay ?? null };
    },
    async demoReplayStep(toStep) {
      await authed(true);
      if (!state.replayRunning) throw new ApiError(409, "CONFLICT", "Replay not started");
      const last = 11;
      if (toStep !== undefined && (toStep <= state.step || toStep > last)) {
        throw new ApiError(409, "CONFLICT", `to_step must be greater than ${state.step} and at most ${last}`);
      }
      state.step = toStep ?? Math.min(last, state.step + 1);
      return { replay: (await this.systemMode()).replay ?? null };
    },
    async auditEvents(entityType, entityId) {
      const user = await authed(true);
      const alert = state.alerts.find((x) => x.id === entityId);
      const report = state.reports.find((x) => x.id === entityId);
      const items = [];
      if (entityType === "alert" && alert) {
        if (alert.status === "AUTO_DISPATCHED") {
          items.push({ id: 1, at: alert.dispatched_at ?? MOCK_ISSUE_TIME, action: "ALERT_AUTO_DISPATCHED", entity_type: "alert", entity_id: alert.id, details: { lead_time_h: alert.lead_time_h }, actor: null });
        }
        if (alert.approved_by && alert.approved_at) {
          items.push({ id: 2, at: alert.approved_at, action: "ALERT_APPROVED", entity_type: "alert", entity_id: alert.id, details: { languages: alert.languages }, actor: { id: alert.approved_by.id, full_name: alert.approved_by.full_name, role: user.role } });
        }
      }
      if (entityType === "report" && report && report.verification_status !== "UNVERIFIED") {
        items.push({ id: 3, at: report.verified_at ?? MOCK_ISSUE_TIME, action: `REPORT_${report.verification_status}`, entity_type: "report", entity_id: report.id, details: { note: report.verification_note }, actor: { id: user.id, full_name: user.full_name, role: user.role } });
      }
      return { items, note: "An actor of null means the system acted automatically (for example an auto-dispatched WATCH). Mock fixture." };
    },
    async runMonitorCycle() {
      await authed(true);
      throw new ApiError(409, "CONFLICT", "In DEMO_REPLAY, cycles run on replay steps. Use the replay controls.");
    },
    async ingestWeather() {
      await authed(true);
      throw new ApiError(409, "CONFLICT", "No weather provider configured in mock mode; rainfall comes from the mock replay fixtures.");
    },
    async demoReset() {
      await authed(true);
      state = freshState();
      return { reset: true };
    },
  };
}
