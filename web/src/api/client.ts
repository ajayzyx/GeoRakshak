// The single typed API client for the dashboard. Both the live (HTTP) and mock
// implementations satisfy `ApiClient`, so components never know which one they use.
import type {
  ActiveModel,
  AuditEventsResponse,
  Alert,
  AlertPatch,
  AlertsResponse,
  ApproveRequest,
  ApproveResponse,
  DashboardSummary,
  DataSourcesResponse,
  DeliveriesResponse,
  DemoReplayResponse,
  ErrorEnvelope,
  Feature,
  FeatureCollection,
  HistoricalLandslideProps,
  LandcoverProps,
  LeadTime,
  LocationProps,
  LoginResponse,
  MediaUrl,
  MonitorRunResponse,
  MonitorWeather,
  Pilot,
  PrioritiesResponse,
  RainfallSeries,
  Report,
  ReportsResponse,
  RiskZoneCollection,
  RiskZoneDetail,
  RoadOverrideRequest,
  RoadSegmentCollection,
  RoadSegmentProps,
  SatelliteLayer,
  SensorStationProps,
  SystemMode,
  SystemStatus,
  User,
  VerifyRequest,
  VerifyResponse,
} from "./types";
import { createMockClient } from "../mock/mockClient";
import { ApiError } from "./errors";

export { ApiError, isUnauthenticated } from "./errors";

export type Bbox = [number, number, number, number];
export type ApiMode = "live" | "mock";

export interface RequestOptions {
  /** Aborts the request (used to drop superseded requests). Aborted calls reject with code ABORTED. */
  signal?: AbortSignal;
  /** Client-side timeout. The call rejects with code TIMEOUT; the server may still be working. */
  timeoutMs?: number;
}

type Opt = RequestOptions | undefined;

export interface ApiClient {
  readonly mode: ApiMode;
  login(email: string, password: string): Promise<LoginResponse>;
  me(o?: Opt): Promise<User>;
  systemMode(o?: Opt): Promise<SystemMode>;
  /** One poll for mode, replay, monitor, pilot, model and every adapter with its display label. */
  systemStatus(o?: Opt): Promise<SystemStatus>;
  pilot(o?: Opt): Promise<Pilot>;
  activeModel(o?: Opt): Promise<ActiveModel>;
  dataSources(o?: Opt): Promise<DataSourcesResponse>;
  dashboardSummary(o?: Opt): Promise<DashboardSummary>;
  riskZones(bbox: Bbox, leadTime: LeadTime, o?: Opt): Promise<RiskZoneCollection>;
  riskZone(id: string, leadTime: LeadTime, o?: Opt): Promise<RiskZoneDetail>;
  locations(bbox: Bbox, o?: Opt): Promise<FeatureCollection<LocationProps>>;
  historicalLandslides(bbox: Bbox, o?: Opt): Promise<FeatureCollection<HistoricalLandslideProps>>;
  landcover(bbox: Bbox, o?: Opt): Promise<FeatureCollection<LandcoverProps>>;
  /** Observed and forecast rainfall series behind the rainfall trigger factor. */
  zoneRainfall(id: string, o?: Opt): Promise<RainfallSeries>;
  satelliteLayers(o?: Opt): Promise<{ items: SatelliteLayer[] }>;
  roadSegments(bbox: Bbox, leadTime: LeadTime, o?: Opt): Promise<RoadSegmentCollection>;
  overrideRoadStatus(id: string, body: RoadOverrideRequest): Promise<Feature<RoadSegmentProps>>;
  sensorStations(bbox: Bbox, o?: Opt): Promise<FeatureCollection<SensorStationProps>>;
  reports(bbox?: Bbox, o?: Opt): Promise<ReportsResponse>;
  report(id: string, o?: Opt): Promise<Report>;
  media(id: string, o?: Opt): Promise<MediaUrl>;
  verifyReport(id: string, body: VerifyRequest): Promise<VerifyResponse>;
  alerts(o?: Opt): Promise<AlertsResponse>;
  patchAlert(id: string, body: AlertPatch): Promise<Alert>;
  approveAlert(id: string, body: ApproveRequest): Promise<ApproveResponse>;
  rejectAlert(id: string, note: string): Promise<Alert>;
  closeAlert(id: string, note: string): Promise<Alert>;
  deliveries(alertId: string, o?: Opt): Promise<DeliveriesResponse>;
  responsePriorities(leadTime: LeadTime, o?: Opt): Promise<PrioritiesResponse>;
  demoReplayStart(o?: Opt): Promise<DemoReplayResponse>;
  /** Without `toStep` advances one step. With `toStep` the backend runs every intermediate cycle. */
  demoReplayStep(toStep?: number, o?: Opt): Promise<DemoReplayResponse>;
  demoReset(o?: Opt): Promise<unknown>;
  /** Admin, LIVE only: runs a monitoring cycle now (409 in DEMO_REPLAY). */
  runMonitorCycle(o?: Opt): Promise<MonitorRunResponse>;
  /** Admin: fetches weather now (409 when no provider is configured, 503 when it is not connected). */
  ingestWeather(o?: Opt): Promise<MonitorWeather>;
  auditEvents(entityType: string, entityId: string, o?: Opt): Promise<AuditEventsResponse>;
}

export interface ClientOptions {
  mode: ApiMode;
  baseUrl: string;
  getToken: () => string | null;
  /** Called when an authenticated request returns 401. Not called for the login call itself. */
  onUnauthenticated: () => void;
  /** Called with false when the backend cannot be reached, and with true when any response arrives. */
  onConnectivityChange?: (reachable: boolean) => void;
  fetchImpl?: typeof fetch;
}

export interface EnvLike {
  VITE_API_MODE?: string;
  VITE_API_BASE_URL?: string;
  VITE_BASEMAP_STYLE_URL?: string;
}

export const DEFAULT_BASE_URL = "http://localhost:8000/api/v1";

export function resolveConfig(env: EnvLike): { mode: ApiMode; baseUrl: string; basemapStyleUrl: string | null } {
  const mode: ApiMode = (env.VITE_API_MODE ?? "").trim().toLowerCase() === "mock" ? "mock" : "live";
  const baseUrl = (env.VITE_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const basemapStyleUrl = env.VITE_BASEMAP_STYLE_URL?.trim() || null;
  return { mode, baseUrl, basemapStyleUrl };
}

export function createApiClient(opts: ClientOptions): ApiClient {
  if (opts.mode === "mock") return createMockClient(opts);
  return createLiveClient(opts);
}

function bboxParam(b: Bbox): string {
  return b.join(",");
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const env = body as Partial<ErrorEnvelope> | null;
  if (env && typeof env === "object" && env.error && typeof env.error.code === "string") {
    return new ApiError(res.status, env.error.code, env.error.message ?? res.statusText, env.error.details ?? [], env.error.request_id);
  }
  const fallbackCode: Record<number, string> = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    503: "UPSTREAM_UNAVAILABLE",
  };
  return new ApiError(res.status, fallbackCode[res.status] ?? "INTERNAL_ERROR", `HTTP ${res.status} ${res.statusText}`.trim());
}

export function createLiveClient(opts: ClientOptions): ApiClient {
  const doFetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, body?: unknown, auth = true, ro?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const token = opts.getToken();
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    // One controller per call, linked to the caller's signal and the optional timeout.
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (ro?.signal) {
      if (ro.signal.aborted) controller.abort();
      else ro.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = ro?.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, ro.timeoutMs)
      : null;

    let res: Response;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) {
        throw new ApiError(0, "TIMEOUT", `No response after ${Math.round((ro?.timeoutMs ?? 0) / 1000)} s. The server may still be processing the request.`);
      }
      if (controller.signal.aborted) throw new ApiError(0, "ABORTED", "Request superseded");
      opts.onConnectivityChange?.(false);
      throw new ApiError(0, "NETWORK_ERROR", `Cannot reach the API at ${opts.baseUrl} (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      if (timer) clearTimeout(timer);
      ro?.signal?.removeEventListener("abort", onAbort);
    }
    opts.onConnectivityChange?.(true);
    if (!res.ok) {
      const err = await toApiError(res);
      if (auth && err.status === 401) opts.onUnauthenticated();
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const get = <T,>(path: string, ro?: RequestOptions) => request<T>("GET", path, undefined, true, ro);
  const post = <T,>(path: string, body: unknown = {}, ro?: RequestOptions) => request<T>("POST", path, body, true, ro);
  const e = encodeURIComponent;

  return {
    mode: "live",
    login: (email, password) => request<LoginResponse>("POST", "/auth/login", { email, password }, false),
    me: (o) => get("/me", o),
    systemMode: (o) => get("/system/mode", o),
    systemStatus: (o) => get("/system/status", o),
    pilot: (o) => get("/pilot", o),
    activeModel: (o) => get("/models/active", o),
    dataSources: (o) => get("/data-sources", o),
    dashboardSummary: (o) => get("/dashboard/summary", o),
    riskZones: (bbox, lt, o) => get(`/risk-zones?bbox=${bboxParam(bbox)}&lead_time_h=${lt}`, o),
    riskZone: (id, lt, o) => get(`/risk-zones/${e(id)}?lead_time_h=${lt}`, o),
    locations: (bbox, o) => get(`/layers/locations?bbox=${bboxParam(bbox)}`, o),
    historicalLandslides: (bbox, o) => get(`/layers/historical-landslides?bbox=${bboxParam(bbox)}`, o),
    landcover: (bbox, o) => get(`/layers/landcover?bbox=${bboxParam(bbox)}`, o),
    zoneRainfall: (id, o) => get(`/risk-zones/${e(id)}/rainfall`, o),
    satelliteLayers: (o) => get("/layers/satellite", o),
    roadSegments: (bbox, lt, o) => get(`/road-segments?bbox=${bboxParam(bbox)}&lead_time_h=${lt}`, o),
    overrideRoadStatus: (id, body) => post(`/road-segments/${e(id)}/status-override`, body),
    sensorStations: (bbox, o) => get(`/sensor-stations?bbox=${bboxParam(bbox)}`, o),
    reports: (bbox, o) => get(bbox ? `/reports?bbox=${bboxParam(bbox)}` : "/reports", o),
    report: (id, o) => get(`/reports/${e(id)}`, o),
    media: (id, o) => get(`/media/${e(id)}`, o),
    verifyReport: (id, body) => post(`/reports/${e(id)}/verify`, body),
    alerts: (o) => get("/alerts", o),
    patchAlert: (id, body) => request("PATCH", `/alerts/${e(id)}`, body),
    approveAlert: (id, body) => post(`/alerts/${e(id)}/approve`, body),
    rejectAlert: (id, note) => post(`/alerts/${e(id)}/reject`, { note }),
    closeAlert: (id, note) => post(`/alerts/${e(id)}/close`, { note }),
    deliveries: (id, o) => get(`/alerts/${e(id)}/deliveries`, o),
    responsePriorities: (lt, o) => get(`/response-priorities?lead_time_h=${lt}`, o),
    demoReplayStart: (o) => post("/demo/replay/start", {}, o),
    demoReplayStep: (toStep, o) => post("/demo/replay/step", toStep === undefined ? {} : { to_step: toStep }, o),
    demoReset: (o) => post("/demo/reset", {}, o),
    runMonitorCycle: (o) => post("/system/monitor/run", {}, o),
    ingestWeather: (o) => post("/system/weather/ingest", {}, o),
    auditEvents: (entityType, entityId, o) => get(`/audit-events?entity_type=${e(entityType)}&entity_id=${e(entityId)}&limit=50`, o),
  };
}
