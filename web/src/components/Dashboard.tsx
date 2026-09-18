import { useCallback, useMemo, useState } from "react";
import type { ActiveModel, SystemStatus } from "../api/types";
import { flattenAdapters } from "../lib/systemStatus";
import { SystemStatusPanel } from "./SystemStatusPanel";
import type { ApiClient, Bbox } from "../api/client";
import { ApiError } from "../api/errors";
import type { Geometry, LeadTime, Pilot, Report, SystemMode, User } from "../api/types";
import { usePolling, type Polled } from "../lib/usePolling";
import { fmtTime } from "../lib/format";
import { ROLE_LABELS, isAuthority } from "../lib/labels";
import { buildDataStrip, type ModelInfo } from "../lib/dataStrip";
import { forecastBanner } from "../lib/forecast";
import { replayNotStarted } from "../lib/replay";
import { Disclaimer } from "./Badges";
import { ErrorBox } from "./ErrorBox";
import { MockBanner, RunModeBanner, UnreachableBanner } from "./RunModeBanner";
import { SummaryStrip } from "./SummaryStrip";
import { DataStrip } from "./DataStrip";
import { ModelChip, PilotName } from "./HeaderChips";
import { MapView, type LayerKey, type MapSelection } from "./MapView";
import { LandcoverLegend, LayerToggles, LeadTimeToggle, RiskLayerInfo, RoadLegend, RoadStatusList, SatelliteList, SeverityLegend, StationList, TopCells } from "./Sidebar";
import { CellDetailPanel } from "./CellDetailPanel";
import { LandslideDetail, LocationDetail, RoadDetail, StationDetail } from "./FeatureDetails";
import { ReportDetail, ReportList } from "./Reports";
import { AlertDetail, AlertList } from "./Alerts";
import { PrioritiesPanel } from "./Priorities";
import { DemoControls } from "./DemoControls";
import { MonitorWarning, SchedulerChip } from "./MonitoringPanel";
import { monitorView } from "../lib/monitor";
import { ResourceStatus, Spinner, StaleBadge } from "./ResourceStatus";

interface Props {
  client: ApiClient;
  user: User;
  apiBaseUrl: string;
  basemapStyleUrl: string | null;
  backendReachable: boolean;
  onLogout: () => void;
}

type Tab = "detail" | "reports" | "alerts" | "priorities";

const POLL_STATUS_MS = 15_000;
const POLL_REPORTS_MS = 8_000;
const POLL_ALERTS_MS = 10_000;
const POLL_STATIONS_MS = 30_000;
const POLL_RISK_MS = 60_000;
// Road collections are large (~1 MB gzipped for a real pilot); they refresh on replay/as_of changes and actions.
const POLL_ROADS_MS = 120_000;

/** Authority-only endpoints are not called for other roles (they would return 403). */
const when = <T,>(cond: boolean, load: () => Promise<T>): Promise<T | null> => (cond ? load() : Promise.resolve(null));

/** Maps an expected 404 to a sentinel instead of an error. */
async function orNone<T>(load: () => Promise<T>): Promise<T | "none"> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return "none";
    throw e;
  }
}

export function Dashboard({ client, user, apiBaseUrl, basemapStyleUrl, backendReachable, onLogout }: Props) {
  const authority = isAuthority(user.role);
  const [version, setVersion] = useState(0);
  const [resetEpoch, setResetEpoch] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const onReset = useCallback(() => setResetEpoch((v) => v + 1), []);

  // One poll carries run mode, replay, monitor, pilot, model and every adapter with its display label.
  const status = usePolling((signal) => client.systemStatus({ signal }), POLL_STATUS_MS, [resetEpoch], version);
  const mode: Polled<SystemMode> = useMemo(
    () => ({ ...status, data: status.data ? { run_mode: status.data.run_mode, replay: status.data.replay, monitor: status.data.monitor } : null }),
    [status],
  );
  const pilot = usePolling((signal) => orNone(() => client.pilot({ signal })), null, [resetEpoch]);
  const modelInfo: ModelInfo | null = status.data ? statusModelInfo(status.data) : status.loading ? null : "unavailable";
  const [statusOpen, setStatusOpen] = useState(false);
  const closeStatus = useCallback(() => setStatusOpen(false), []);

  // Any change in the replay state (step, as_of, start or reset elsewhere) refreshes every view once.
  const replayKey = mode.data ? JSON.stringify(mode.data.replay ?? null) : "";

  if (user.role === "CITIZEN") {
    return (
      <div className="login-wrap">
        <div className="card login">
          <h1>GeoRakshak</h1>
          <p>The web dashboard is for authorities and field officers. Citizens use the GeoRakshak mobile app.</p>
          <button onClick={onLogout}>Log out</button>
        </div>
      </div>
    );
  }

  const pilotData = pilot.data && pilot.data !== "none" ? pilot.data : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          GeoRakshak {pilotData && <PilotName pilot={pilotData} />} <ModelChip model={modelInfo} /> <SchedulerChip mode={mode.data} />
        </div>
        <div className="user">
          <button type="button" className="primary" onClick={() => setStatusOpen(true)} data-testid="open-system-status">System status</button>
          <span>{user.full_name}</span>
          <span className="badge role">{ROLE_LABELS[user.role] ?? user.role}</span>
          {user.is_demo_account && <span className="badge">demo account</span>}
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>
      {!backendReachable && client.mode === "live" && <UnreachableBanner baseUrl={apiBaseUrl} />}
      {client.mode === "mock" && <MockBanner />}
      <RunModeBanner mode={mode.data} failed={!!mode.error && !mode.data} />
      <SystemStatusPanel client={client} status={status} isAdmin={user.role === "ADMIN"} open={statusOpen} onClose={closeStatus} />
      <Disclaimer />
      {pilot.data === "none" ? (
        <div className="empty-state" data-testid="no-pilot">
          <h2>No pilot area loaded</h2>
          <p>The backend has no active pilot area (GET /pilot returned 404). Load a pilot handoff on the backend, then retry.</p>
          <button onClick={pilot.refresh}>Retry</button>
        </div>
      ) : !pilotData ? (
        <div className="pad">
          <ResourceStatus resource={pilot} label="pilot area" />
        </div>
      ) : (
        <Workspace
          key={resetEpoch}
          client={client}
          pilot={pilotData}
          authority={authority}
          isAdmin={user.role === "ADMIN"}
          mode={mode}
          status={status}
          modelInfo={modelInfo}
          apiBaseUrl={apiBaseUrl}
          basemapStyleUrl={basemapStyleUrl}
          refreshKey={`${version}|${replayKey}`}
          bump={bump}
          onReset={onReset}
        />
      )}
    </div>
  );
}

interface WorkspaceProps {
  client: ApiClient;
  pilot: Pilot;
  authority: boolean;
  isAdmin: boolean;
  mode: Polled<SystemMode>;
  status: Polled<SystemStatus>;
  modelInfo: ModelInfo | null;
  apiBaseUrl: string;
  basemapStyleUrl: string | null;
  refreshKey: string;
  bump: () => void;
  onReset: () => void;
}

function centroid(g: Geometry): [number, number] | null {
  const pts: [number, number][] =
    g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiLineString" ? g.coordinates.flat() : g.coordinates.flat(2);
  if (pts.length === 0) return null;
  const [sx, sy] = pts.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / pts.length, sy / pts.length];
}

/** The status endpoint's model block in the shape the header chip and strip already understand. */
function statusModelInfo(s: SystemStatus): ModelInfo {
  const m = s.model;
  if (!m) return "none";
  const model: ActiveModel = {
    version: m.version,
    model_type: m.model_type,
    stage: m.stage,
    thresholds: { calibrated: m.calibrated },
    validated: m.validated,
    validation_scheme: m.validation_scheme,
    metrics: m.metrics,
    forecast_skill_evaluated: m.forecast_skill_evaluated,
    model_card_uri: m.model_card_uri,
  };
  return model;
}

function Workspace({ client, pilot, authority, isAdmin, mode, status, modelInfo, apiBaseUrl, basemapStyleUrl, refreshKey, bump, onReset }: WorkspaceProps) {
  const bbox = pilot.bbox as Bbox;
  const [leadTime, setLeadTime] = useState<LeadTime>(0);
  const [visible, setVisible] = useState<Record<LayerKey, boolean>>({ risk: true, landcover: false, landslides: false, locations: true, roads: true, stations: true, reports: true, satellite: false });
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [focus, setFocus] = useState<{ center: [number, number]; key: number } | null>(null);
  const [tab, setTab] = useState<Tab>("detail");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  const summary = usePolling((signal) => when(authority, () => client.dashboardSummary({ signal })), POLL_STATUS_MS, [], refreshKey);
  // A new assessment time (LIVE scheduler or replay) refreshes the map layers once.
  const dataKey = `${refreshKey}|${summary.data?.as_of ?? ""}`;

  const risk = usePolling((signal) => client.riskZones(bbox, leadTime, { signal }), POLL_RISK_MS, [leadTime], dataKey);
  const roads = usePolling((signal) => client.roadSegments(bbox, leadTime, { signal }), POLL_ROADS_MS, [leadTime], dataKey);
  const locations = usePolling((signal) => client.locations(bbox, { signal }), null, [], dataKey);
  const landslides = usePolling((signal) => client.historicalLandslides(bbox, { signal }), null, []);
  const landcover = usePolling((signal) => client.landcover(bbox, { signal }), null, []);
  const stations = usePolling((signal) => client.sensorStations(bbox, { signal }), POLL_STATIONS_MS, [], dataKey);
  const satellite = usePolling((signal) => client.satelliteLayers({ signal }), null, []);
  const reports = usePolling((signal) => when(authority, () => client.reports(bbox, { signal })), POLL_REPORTS_MS, [], dataKey);
  const alerts = usePolling((signal) => when(authority, () => client.alerts({ signal })), POLL_ALERTS_MS, [], dataKey);
  const priorities = usePolling((signal) => when(authority, () => client.responsePriorities(leadTime, { signal })), POLL_STATUS_MS, [leadTime], dataKey);

  const select = useCallback((s: MapSelection, center?: [number, number] | null) => {
    setSelection(s);
    if (center) setFocus((f) => ({ center, key: (f?.key ?? 0) + 1 }));
    if (s.kind === "report") {
      setSelectedReportId(s.id);
      setTab("reports");
    } else {
      setTab("detail");
    }
  }, []);

  const riskFeatures = risk.data?.features;
  const showCell = useCallback(
    (id: string) => {
      const f = riskFeatures?.find((x) => x.id === id);
      select({ kind: "cell", id }, f ? centroid(f.geometry) : null);
    },
    [riskFeatures, select],
  );
  const roadFeatures = roads.data?.features;
  const showRoad = useCallback(
    (id: string) => {
      const f = roadFeatures?.find((x) => x.id === id);
      select({ kind: "road", id }, f ? centroid(f.geometry) : null);
    },
    [roadFeatures, select],
  );
  const openReport = useCallback((id: string) => {
    setSelectedReportId(id);
    setTab("reports");
  }, []);
  const openAlert = (id: string) => {
    setSelectedAlertId(id);
    setTab("alerts");
  };

  const reportItems = reports.data?.items ?? null;
  const selectedAlert = alerts.data?.items.find((a) => a.id === selectedAlertId) ?? null;
  const sourceItems = useMemo(() => (status.data ? flattenAdapters(status.data) : null), [status.data]);

  const strip = useMemo(
    () => buildDataStrip({ sources: sourceItems, mode: mode.data, model: modelInfo ?? "unavailable", riskMeta: risk.data?.metadata, leadTime }),
    [sourceItems, mode.data, modelInfo, risk.data, leadTime],
  );
  // While the layer loads, the caveat still applies: no forecast skill is claimed anywhere.
  const banner =
    leadTime > 0
      ? risk.data
        ? forecastBanner(leadTime, risk.data.metadata, sourceItems)
        : { text: `FORECAST +${leadTime} h — loading forecast layer… · forecast skill not evaluated`, simulated: false }
      : null;

  function detailContent() {
    if (!selection || selection.kind === "report") {
      return <p className="muted">Click a risk cell, road, station, location or landslide record on the map, or pick one from the lists on the left.</p>;
    }
    switch (selection.kind) {
      case "cell":
        return (
          <CellDetailPanel
            client={client}
            cellId={selection.id}
            leadTime={leadTime}
            refreshKey={dataKey}
            landcover={landcover.data?.features.find((f) => f.id === selection.id)?.properties ?? null}
            landcoverMeta={landcover.data?.metadata}
            canSeeRainfall={authority}
            onOpenAlert={authority ? openAlert : undefined}
          />
        );
      case "road": {
        if (!roads.data) return <ResourceStatus resource={roads} label="road segments" />;
        const f = roads.data.features.find((x) => x.id === selection.id);
        return f ? (
          <>
            <StaleBadge resource={roads} />
            <RoadDetail key={f.id} client={client} road={f} canOverride={authority} fallbackProvenance={roads.data.metadata?.provenance} onChanged={bump} onOpenReport={authority ? openReport : undefined} />
          </>
        ) : (
          <p className="muted">Road segment not in the current layer.</p>
        );
      }
      case "station": {
        if (!stations.data) return <ResourceStatus resource={stations} label="sensor stations" />;
        const f = stations.data.features.find((x) => x.id === selection.id);
        return f ? <StationDetail station={f} /> : <p className="muted">Station not found.</p>;
      }
      case "location": {
        if (!locations.data) return <ResourceStatus resource={locations} label="locations" />;
        const f = locations.data.features.find((x) => x.id === selection.id);
        return f ? <LocationDetail location={f} fallbackProvenance={locations.data.metadata?.provenance} /> : <p className="muted">Location not found.</p>;
      }
      case "landslide": {
        if (!landslides.data) return <ResourceStatus resource={landslides} label="landslide records" />;
        const f = landslides.data.features.find((x) => x.id === selection.id);
        return f ? <LandslideDetail event={f} fallbackProvenance={landslides.data.metadata?.provenance} /> : <p className="muted">Record not found.</p>;
      }
    }
  }

  const monitorState = monitorView(mode.data, new Date());
  const notStarted = replayNotStarted(mode.data);
  const riskEmpty = risk.data !== null && risk.data.features.length === 0;

  return (
    <>
      <DataStrip entries={strip} />
      {authority && (
        <div className="summary-wrap">
          {summary.data ? <SummaryStrip summary={summary.data} /> : <ResourceStatus resource={summary} label="dashboard summary" />}
          {summary.data && <StaleBadge resource={summary} />}
        </div>
      )}
      <main className="layout">
        <aside className="sidebar">
          <section className="panel">
            <h3>Lead time</h3>
            <LeadTimeToggle value={leadTime} onChange={setLeadTime} />
            {risk.data ? <RiskLayerInfo metadata={risk.data.metadata} leadTime={leadTime} /> : <ResourceStatus resource={risk} label={`risk zones (${leadTime === 0 ? "current" : `+${leadTime} h`})`} />}
          </section>
          <section className="panel">
            <h3>Layers</h3>
            <LayerToggles
              visible={visible}
              onToggle={(k) => setVisible((v) => ({ ...v, [k]: !v[k] }))}
              status={{
                risk: { resource: risk, count: risk.data?.features.length ?? null },
                roads: { resource: roads, count: roads.data?.features.length ?? null },
                locations: { resource: locations, count: locations.data?.features.length ?? null },
                landslides: { resource: landslides, count: landslides.data?.features.length ?? null },
                landcover: { resource: landcover, count: landcover.data?.features.length ?? null },
                stations: { resource: stations, count: stations.data?.features.length ?? null },
                ...(authority ? { reports: { resource: reports, count: reportItems?.length ?? null } } : {}),
                satellite: { resource: satellite, count: satellite.data?.items.length ?? null },
              }}
            />
            <h4>Highest-risk cells ({leadTime === 0 ? "current" : `+${leadTime} h`})</h4>
            <TopCells risk={risk.data} onSelect={showCell} />
            <h4>Road status</h4>
            <RoadStatusList roads={roads.data} onSelect={showRoad} />
            <h4>Land cover (satellite-derived, not imagery)</h4>
            <LandcoverLegend landcover={landcover.data} />
            <h4>Severity</h4>
            <SeverityLegend />
            <h4>Road status legend</h4>
            <RoadLegend />
            {roads.data?.metadata?.attribution && <p className="small muted">Roads: {roads.data.metadata.attribution}</p>}
            <h4>Sensor stations</h4>
            {stations.data && stations.data.features.length === 0 ? <p className="small muted">No sensor stations registered.</p> : <StationList stations={stations.data} onSelect={(id) => select({ kind: "station", id })} />}
            <h4>Satellite layers</h4>
            <SatelliteList layers={satellite.data?.items ?? null} />
          </section>
          {isAdmin && mode.data?.run_mode === "DEMO_REPLAY" && <DemoControls client={client} mode={mode.data} onChanged={mode.refresh} onReset={onReset} />}
        </aside>
        <div className="map-wrap">
          <MapView
            pilot={pilot}
            basemapStyleUrl={basemapStyleUrl}
            riskZones={risk.data}
            roads={roads.data}
            locations={locations.data}
            landslides={landslides.data}
            landcover={landcover.data}
            stations={stations.data}
            reports={reportItems}
            satellite={satellite.data?.items ?? null}
            visible={visible}
            forecast={leadTime > 0}
            selected={selection}
            onSelect={select}
            focus={focus}
          />
          {banner && (
            <div
              className={banner.simulated ? "map-banner simulated" : "map-banner"}
              data-testid="forecast-banner"
              data-loading={risk.data ? "false" : "true"}
            >
              {banner.text}
              {risk.data?.metadata?.issue_time && <span className="small"> · issued {fmtTime(risk.data.metadata.issue_time)}</span>}
            </div>
          )}
          <div className="map-status" data-testid="map-status">
            <MonitorWarning view={monitorState} />
            {risk.data === null && risk.loading && <Spinner label={`Loading risk zones (${leadTime === 0 ? "current" : `+${leadTime} h`})…`} />}
            {risk.data === null && risk.error && <ErrorBox error={risk.error} context="Risk zones" onRetry={risk.refresh} />}
            {riskEmpty && (
              <div className="notice" data-testid="empty-risk">
                {notStarted ? "Replay not started — no risk assessments yet." : `No risk assessments ${leadTime === 0 ? "for the current time" : `at +${leadTime} h`} yet.`}
              </div>
            )}
            <StaleBadge resource={risk} />
            {roads.data === null && roads.loading && <Spinner label="Loading road segments…" />}
            {roads.data === null && roads.error && <ErrorBox error={roads.error} context="Road segments" onRetry={roads.refresh} />}
          </div>
          {pilot.boundary_note && <div className="map-note">{pilot.boundary_note}</div>}
        </div>
        <aside className="rightpanel">
          <nav className="tabs">
            <button className={tab === "detail" ? "tab active" : "tab"} onClick={() => setTab("detail")} data-testid="tab-detail">Detail</button>
            {authority && (
              <button className={tab === "reports" ? "tab active" : "tab"} onClick={() => setTab("reports")} data-testid="tab-reports">
                Reports{reportItems ? ` (${reportItems.filter((r) => r.verification_status === "UNVERIFIED").length})` : ""}
              </button>
            )}
            {authority && <button className={tab === "alerts" ? "tab active" : "tab"} onClick={() => setTab("alerts")} data-testid="tab-alerts">Alerts</button>}
            {authority && <button className={tab === "priorities" ? "tab active" : "tab"} onClick={() => setTab("priorities")} data-testid="tab-priorities">Priorities</button>}
          </nav>
          <div className="tab-body">
            {tab === "detail" && detailContent()}
            {tab === "reports" && (
              <>
                <ReportList resource={reports} selectedId={selectedReportId} onSelect={(id) => { setSelectedReportId(id); setSelection({ kind: "report", id }); }} />
                {selectedReportId && (
                  <SelectedReport key={selectedReportId} client={client} id={selectedReportId} fromList={reportItems?.find((r) => r.id === selectedReportId) ?? null} apiBaseUrl={apiBaseUrl} canVerify={authority} onChanged={bump} onShowCell={showCell} />
                )}
              </>
            )}
            {tab === "alerts" && (
              <>
                <AlertList resource={alerts} selectedId={selectedAlertId} onSelect={setSelectedAlertId} />
                {selectedAlert && <AlertDetail key={selectedAlert.id} client={client} alert={selectedAlert} canAct={authority} onChanged={bump} onShowCell={showCell} />}
              </>
            )}
            {tab === "priorities" && <PrioritiesPanel resource={priorities} onShowCell={showCell} />}
          </div>
        </aside>
      </main>
    </>
  );
}

interface SelectedReportProps {
  client: ApiClient;
  id: string;
  fromList: Report | null;
  apiBaseUrl: string;
  canVerify: boolean;
  onChanged: () => void;
  onShowCell: (id: string) => void;
}

/** Shows a report from the polled list, or fetches it by id (e.g. opened from a road's linked report). */
function SelectedReport({ client, id, fromList, apiBaseUrl, canVerify, onChanged, onShowCell }: SelectedReportProps) {
  const fetched = usePolling((signal) => (fromList ? Promise.resolve(null) : client.report(id, { signal })), null, [id, fromList === null]);
  const report = fromList ?? fetched.data;
  if (!report) return <ResourceStatus resource={fetched} label="report" />;
  return <ReportDetail client={client} report={report} apiBaseUrl={apiBaseUrl} canVerify={canVerify} onChanged={onChanged} onShowCell={onShowCell} />;
}

