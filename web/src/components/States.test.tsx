import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../api/errors";
import type { ApiClient } from "../api/client";
import type { RiskZoneDetail, SystemMode } from "../api/types";
import { loggedInMockClient, mockUser } from "../test/fakeClient";
import { CellDetail, CellDetailPanel } from "./CellDetailPanel";
import { ReportList } from "./Reports";
import { AlertList } from "./Alerts";
import { DemoControls } from "./DemoControls";
import { RoadDetail } from "./FeatureDetails";
import { MonitorWarning, MonitoringPanel } from "./MonitoringPanel";
import { monitorView } from "../lib/monitor";
import { AuditTrail } from "./AuditTrail";
import { LandcoverLegend } from "./Sidebar";
import { RainfallStrip } from "./RainfallStrip";
import { Dashboard } from "./Dashboard";
import { usePolling } from "../lib/usePolling";

// The map needs WebGL, which jsdom lacks.
vi.mock("./MapView", () => ({ MapView: () => <div data-testid="map-stub" /> }));

const detail = (id: string, assessment: RiskZoneDetail["assessment"]): RiskZoneDetail => ({
  id,
  grid_code: `GRID-${id}`,
  admin_boundary: null,
  assessment,
  exposure: { villages: 0, schools: 0, health_facilities: 0, road_segments_at_risk: 0 },
  open_alerts: [],
  disclaimer: "Decision-support risk estimate. Not an official warning.",
});

const assessment = (lead: number): NonNullable<RiskZoneDetail["assessment"]> => ({
  id: "ra1",
  lead_time_h: lead,
  score: 0.5,
  severity: "HIGH",
  confidence: "LOW",
  model_version: "b0-rules-0.1.0",
  issue_time: "2017-06-14T00:00:00Z",
  run_mode: "DEMO_REPLAY",
  provenance: "MODEL_OUTPUT",
  factors: [],
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  return { promise: new Promise<T>((r) => (resolve = r)), resolve };
}

function fakeClient(over: Partial<ApiClient>): ApiClient {
  return over as ApiClient;
}

describe("cell detail states", () => {
  it("shows the empty state when the cell has no assessment for the lead time", async () => {
    const client = fakeClient({ riskZone: () => Promise.resolve(detail("c1", null)) });
    render(<CellDetailPanel client={client} cellId="c1" leadTime={48} refreshKey={0} />);
    expect(await screen.findByTestId("no-assessment")).toBeTruthy();
    expect(screen.getByTestId("no-assessment").textContent).toContain("No assessment for this cell at this lead time yet");
  });

  it("shows a spinner first, then an error with a working Retry", async () => {
    let attempt = 0;
    const client = fakeClient({
      riskZone: () => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new ApiError(503, "UPSTREAM_UNAVAILABLE", "database unavailable")) : Promise.resolve(detail("c1", assessment(0)));
      },
    });
    render(<CellDetailPanel client={client} cellId="c1" leadTime={0} refreshKey={0} />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    expect(await screen.findByTestId("error-box")).toBeTruthy();
    fireEvent.click(screen.getByTestId("retry"));
    expect(await screen.findByTestId("cell-detail")).toBeTruthy();
    expect(screen.queryByTestId("error-box")).toBeNull();
  });

  it("never shows another cell's detail when a slow response arrives late", async () => {
    const first = deferred<RiskZoneDetail>();
    const second = deferred<RiskZoneDetail>();
    let calls = 0;
    const client = fakeClient({
      riskZone: () => {
        calls += 1;
        return calls === 1 ? first.promise : second.promise;
      },
    });
    const { rerender } = render(<CellDetailPanel client={client} cellId="c1" leadTime={0} refreshKey={0} />);
    rerender(<CellDetailPanel client={client} cellId="c2" leadTime={0} refreshKey={0} />);
    await act(async () => first.resolve(detail("c1", assessment(0))));
    expect(screen.queryByTestId("cell-detail")).toBeNull();
    await act(async () => second.resolve(detail("c2", assessment(0))));
    expect(screen.getByTestId("cell-grid-code").textContent).toBe("GRID-c2");
  });

  it("never shows another lead time's detail after a fast toggle", async () => {
    const slow = deferred<RiskZoneDetail>();
    let calls = 0;
    const client = fakeClient({
      riskZone: (_id, lead) => {
        calls += 1;
        return calls === 1 ? slow.promise : Promise.resolve(detail("c1", assessment(lead)));
      },
    });
    const { rerender } = render(<CellDetailPanel client={client} cellId="c1" leadTime={0} refreshKey={0} />);
    rerender(<CellDetailPanel client={client} cellId="c1" leadTime={72} refreshKey={0} />);
    await act(async () => slow.resolve(detail("c1", assessment(0))));
    await waitFor(() => expect(screen.getByTestId("cell-detail").getAttribute("data-lead-time")).toBe("72"));
  });
});

/** Renders a resource-backed list with a controllable loader. */
function ListHarness({ load, kind }: { load: () => Promise<{ items: never[]; next_cursor: null }>; kind: "reports" | "alerts" }) {
  const resource = usePolling(load, null, []);
  return kind === "reports" ? (
    <ReportList resource={resource} selectedId={null} onSelect={() => {}} />
  ) : (
    <AlertList resource={resource} selectedId={null} onSelect={() => {}} />
  );
}

describe("list states", () => {
  it("reports: loading, then the empty state", async () => {
    render(<ListHarness kind="reports" load={() => Promise.resolve({ items: [], next_cursor: null })} />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    expect((await screen.findByTestId("empty-reports")).textContent).toBe("No reports yet");
  });

  it("reports: error with Retry when nothing could be loaded", async () => {
    render(<ListHarness kind="reports" load={() => Promise.reject(new ApiError(500, "INTERNAL_ERROR", "boom"))} />);
    expect(await screen.findByTestId("error-box")).toBeTruthy();
    expect(screen.getByTestId("retry")).toBeTruthy();
  });

  it("alerts: empty state", async () => {
    render(<ListHarness kind="alerts" load={() => Promise.resolve({ items: [], next_cursor: null })} />);
    expect((await screen.findByTestId("empty-alerts")).textContent).toBe("No alerts");
  });
});

const replayMode = (step: number): SystemMode => ({
  run_mode: "DEMO_REPLAY",
  replay: { scenario: "pilot-rainfall-replay", provenance: "REAL_HISTORICAL", step, steps: 47, as_of: "2017-06-14T00:00:00+00:00" },
});

describe("demo controls", () => {
  it("shows 'Replay not started' and disables Step until a replay exists", () => {
    render(<DemoControls client={fakeClient({})} mode={{ run_mode: "DEMO_REPLAY", replay: null }} onChanged={() => {}} onReset={() => {}} />);
    expect(screen.getByTestId("demo-step").textContent).toBe("Replay not started");
    expect((screen.getByRole("button", { name: "Step" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Start replay" })).toBeTruthy();
  });

  it("shows the step as 'Step X/Y · date'", () => {
    render(<DemoControls client={fakeClient({})} mode={replayMode(29)} onChanged={() => {}} onReset={() => {}} />);
    expect(screen.getByTestId("demo-step").textContent).toBe("Step 29/46 · 2017-06-14");
  });

  it("jumps to a step and reports when the backend lands on a different one", async () => {
    const demoReplayStep = vi.fn((_toStep?: number) => Promise.resolve({ replay: replayMode(30).replay ?? null }));
    const onChanged = vi.fn();
    render(<DemoControls client={fakeClient({ demoReplayStep })} mode={replayMode(29)} onChanged={onChanged} onReset={() => {}} />);
    fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "35" } });
    fireEvent.click(screen.getByTestId("jump-button"));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(demoReplayStep.mock.calls[0]?.[0]).toBe(35);
    expect(screen.getByRole("status").textContent).toContain("Backend is at step 30, not the requested step 35");
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the backend error when a jump is rejected", async () => {
    const demoReplayStep = vi.fn(() => Promise.reject(new ApiError(409, "CONFLICT", "to_step must be greater than 29")));
    render(<DemoControls client={fakeClient({ demoReplayStep })} mode={replayMode(29)} onChanged={() => {}} onReset={() => {}} />);
    fireEvent.change(screen.getByTestId("jump-input"), { target: { value: "31" } });
    fireEvent.click(screen.getByTestId("jump-button"));
    expect((await screen.findByTestId("error-box")).textContent).toContain("to_step must be greater than 29");
  });

  it("only resets after confirmation", async () => {
    const demoReset = vi.fn(() => Promise.resolve({}));
    const onReset = vi.fn();
    const { rerender } = render(<DemoControls client={fakeClient({ demoReset })} mode={replayMode(3)} onChanged={() => {}} onReset={onReset} confirm={() => false} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset…" }));
    expect(demoReset).not.toHaveBeenCalled();
    rerender(<DemoControls client={fakeClient({ demoReset })} mode={replayMode(3)} onChanged={() => {}} onReset={onReset} confirm={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset…" }));
    await waitFor(() => expect(onReset).toHaveBeenCalled());
    expect(demoReset).toHaveBeenCalledTimes(1);
  });
});

describe("dashboard states", () => {
  it("shows 'No pilot area loaded' with a Retry when GET /pilot returns 404", async () => {
    const base = await loggedInMockClient();
    const client = Object.assign({}, base, { pilot: () => Promise.reject(new ApiError(404, "NOT_FOUND", "No pilot area loaded")) }) as ApiClient;
    render(<Dashboard client={client} user={mockUser()} apiBaseUrl="http://api.test/api/v1" basemapStyleUrl={null} backendReachable onLogout={() => {}} />);
    expect(await screen.findByTestId("no-pilot")).toBeTruthy();
    expect(screen.getByTestId("no-pilot").textContent).toContain("No pilot area loaded");
  });

  it("shows the backend-unreachable banner and keeps the disclaimer", async () => {
    const client = Object.assign({}, await loggedInMockClient(), { mode: "live" as const });
    render(<Dashboard client={client} user={mockUser()} apiBaseUrl="http://api.test/api/v1" basemapStyleUrl={null} backendReachable={false} onLogout={() => {}} />);
    expect(screen.getByTestId("backend-unreachable").textContent).toContain("BACKEND UNREACHABLE (http://api.test/api/v1)");
  });

  it("shows the honest data strip, the provisional pilot badge and the model chip", async () => {
    const client = await loggedInMockClient();
    render(<Dashboard client={client} user={mockUser("ADMIN")} apiBaseUrl="http://api.test/api/v1" basemapStyleUrl={null} backendReachable onLogout={() => {}} />);
    await waitFor(() => expect(within(screen.getByTestId("strip-sms")).queryByText("Sandbox — not sent")).toBeTruthy());
    expect(screen.getByTestId("strip-soil").textContent).toContain("Virtual sensors (simulated)");
    expect(screen.getByTestId("strip-rainfall").textContent).toContain("Replay not started");
    expect(await screen.findByTestId("pilot-provisional")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("model-chip").textContent).toContain("baseline, no validated accuracy"));
    expect(screen.getByTestId("replay-not-started")).toBeTruthy();
  });

  it("shows the simulated-forecast banner over the map when a lead time is selected", async () => {
    const client = await loggedInMockClient();
    render(<Dashboard client={client} user={mockUser()} apiBaseUrl="http://api.test/api/v1" basemapStyleUrl={null} backendReachable onLogout={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("map-stub")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "+48 h" }));
    await waitFor(() =>
      expect(screen.getByTestId("forecast-banner").textContent).toContain("SIMULATED FORECAST +48 h — replay stand-in, not a weather forecast · forecast skill not evaluated"),
    );
  });
});

describe("road detail", () => {
  const road = {
    type: "Feature" as const,
    id: "rs-1",
    geometry: { type: "LineString" as const, coordinates: [[92.7, 23.7] as [number, number], [92.71, 23.71] as [number, number]] },
    properties: {
      road_class: "secondary",
      status: "BLOCKED" as const,
      status_source: "VERIFIED_REPORT",
      status_reason: "Verified report: road blocked by debris",
      status_report_id: "rp-9",
      status_updated_at: "2017-06-14T06:52:00Z",
      provenance: "MODEL_OUTPUT" as const,
    },
  };

  it("names the status source, links the report and says when villages are not reported", () => {
    const onOpenReport = vi.fn();
    render(<RoadDetail client={fakeClient({})} road={road} canOverride={false} onChanged={() => {}} onOpenReport={onOpenReport} />);
    expect(screen.getByTestId("road-status").textContent).toBe("Blocked");
    expect(screen.getByTestId("road-status-source").textContent).toContain("Verified field report (VERIFIED_REPORT)");
    expect(screen.getByText("Verified report: road blocked by debris")).toBeTruthy();
    expect(screen.getByText("not reported by the API")).toBeTruthy();
    fireEvent.click(screen.getByTestId("road-linked-report"));
    expect(onOpenReport).toHaveBeenCalledWith("rp-9");
    expect(screen.getByText("OPEN = no evidence of blockage, not confirmed passable")).toBeTruthy();
  });

  it("refreshes the view after an authority override", async () => {
    const overrideRoadStatus = vi.fn(() => Promise.resolve({ ...road, properties: { ...road.properties, status: "OPEN" as const, status_source: "AUTHORITY_OVERRIDE" } }));
    const onChanged = vi.fn();
    render(<RoadDetail client={fakeClient({ overrideRoadStatus })} road={road} canOverride onChanged={onChanged} />);
    fireEvent.change(screen.getByPlaceholderText(/Cleared, confirmed/), { target: { value: "Cleared by field team" } });
    fireEvent.click(screen.getByRole("button", { name: "Override status" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(overrideRoadStatus).toHaveBeenCalledWith("rs-1", { status: "BLOCKED", reason: "Cleared by field team" });
    expect(screen.getByText(/Status is now/).textContent).toContain("Authority override");
  });
});

const liveMonitor = (over: Partial<import("../api/types").MonitorState> = {}): SystemMode => ({
  run_mode: "LIVE",
  replay: null,
  monitor: {
    enabled: true,
    interval_s: 180,
    weather_provider: "open-meteo",
    last_run_at: new Date(Date.now() - 60_000).toISOString(),
    last_status: "OK",
    last_error: null,
    next_run_at: new Date(Date.now() + 120_000).toISOString(),
    result: { scored: 2798, model_version: "b0-rules-0.1.0", roads_at_risk: 4, villages_access_at_risk: 1, watch_created: "al-1", watches_auto_closed: 0 },
    weather: { provider: "open-meteo", points: 9, observations: 27980, forecasts: 8394, observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast", is_imd: false },
    weather_error: null,
    ...over,
  },
});

const weatherSources = [
  { slug: "open-meteo-recent", kind: "WEATHER_HISTORICAL", connection_status: "CONNECTED_LIVE" as const, provenance_default: "REAL_LIVE" as const, status_note: "Model-derived daily precipitation, not gauge observations. Non-IMD source (H16)." },
  { slug: "open-meteo-forecast", kind: "WEATHER_FORECAST", connection_status: "CONNECTED_LIVE" as const, provenance_default: "REAL_LIVE" as const },
];

describe("monitoring panel", () => {
  it("shows a healthy LIVE scheduler with interval, runs, results and weather rows", () => {
    render(<MonitoringPanel client={fakeClient({})} mode={liveMonitor()} sources={weatherSources} isAdmin={false} onChanged={() => {}} />);
    expect(screen.getByTestId("monitor-scheduler").textContent).toContain("Scheduler LIVE");
    expect(screen.getByTestId("monitor-scheduler").textContent).toContain("every 3 min");
    expect(screen.getByTestId("monitor-last-run").textContent).toContain("OK");
    expect(screen.getByTestId("monitor-next-run").textContent).toContain("in 2 min");
    expect(screen.getByTestId("monitor-result").textContent).toContain("2798 cells scored");
    expect(screen.getByTestId("monitor-weather-provider").textContent).toBe("open-meteo");
    expect(screen.getByTestId("monitor-weather-imd").textContent).toContain("Non-IMD");
    expect(screen.getByTestId("monitor-weather-counts").textContent).toContain("27980 observations");
    expect(within(screen.getByTestId("weather-row-observed")).getByTestId("connection-badge").textContent).toContain("CONNECTED_LIVE");
    expect(screen.getByTestId("weather-row-observed").textContent).toContain("not gauge observations");
    expect(monitorView(liveMonitor(), new Date()).warning).toBeNull();
    // Non-admins get no controls.
    expect(screen.queryByTestId("monitor-run-cycle")).toBeNull();
    expect(screen.queryByTestId("monitor-fetch-weather")).toBeNull();
  });

  it("makes a failed cycle unmissable with the error and a map warning", () => {
    const mode = liveMonitor({ last_status: "FAILED", last_error: "open-meteo request timed out" });
    render(
      <>
        <MonitorWarning view={monitorView(mode, new Date())} />
        <MonitoringPanel client={fakeClient({})} mode={mode} sources={weatherSources} isAdmin={false} onChanged={() => {}} />
      </>,
    );
    expect(screen.getByTestId("monitor-scheduler").getAttribute("data-health")).toBe("FAILED");
    expect(screen.getByTestId("monitor-last-error").textContent).toContain("open-meteo request timed out");
    const warning = screen.getByTestId("monitor-warning");
    expect(warning.textContent).toContain("Last monitoring cycle failed — displayed risk may be out of date");
    expect(warning.textContent).toContain("open-meteo request timed out");
  });

  it("flags an overdue cycle", () => {
    const mode = liveMonitor({ last_run_at: new Date(Date.now() - 20 * 60_000).toISOString() });
    render(<MonitorWarning view={monitorView(mode, new Date())} />);
    expect(screen.getByTestId("monitor-warning").getAttribute("data-health")).toBe("STALE");
    expect(screen.getByTestId("monitor-warning").textContent).toContain("No monitoring cycle for 20 min");
  });

  it("says the scheduler is stopped", () => {
    const mode = liveMonitor({ enabled: false });
    render(<MonitoringPanel client={fakeClient({})} mode={mode} sources={weatherSources} isAdmin onChanged={() => {}} />);
    expect(screen.getByTestId("monitor-scheduler").textContent).toContain("Scheduler STOPPED");
    expect(monitorView(mode, new Date()).warning).not.toBeNull();
  });

  it("shows the DEMO_REPLAY note and hides both admin buttons", () => {
    const mode: SystemMode = {
      run_mode: "DEMO_REPLAY",
      replay: null,
      monitor: { enabled: false, interval_s: null, weather_provider: "none", last_run_at: null, last_status: null, last_error: null, next_run_at: null, result: null, weather: null, weather_error: null, note: "DEMO_REPLAY: cycles run on replay steps, not on a timer" },
    };
    render(<MonitoringPanel client={fakeClient({})} mode={mode} sources={[]} isAdmin onChanged={() => {}} />);
    expect(screen.getByTestId("monitor-detail").textContent).toBe("DEMO_REPLAY: cycles run on replay steps, not on a timer");
    expect(screen.getByTestId("monitor-weather").textContent).toContain("No weather provider connected");
    expect(screen.queryByTestId("monitor-run-cycle")).toBeNull();
    expect(screen.queryByTestId("monitor-fetch-weather")).toBeNull();
    expect(screen.queryByTestId("monitor-last-run")).toBeNull();
  });

  it("says plainly when LIVE has no weather provider, and hides only the weather button", () => {
    const mode = liveMonitor({ weather_provider: "none", weather: null });
    render(<MonitoringPanel client={fakeClient({})} mode={mode} sources={[{ slug: "imd-gridded-rainfall", kind: "WEATHER_HISTORICAL", connection_status: "CONNECTED_HISTORICAL" }]} isAdmin onChanged={() => {}} />);
    expect(screen.getByTestId("monitor-weather").textContent).toContain("No weather provider connected");
    expect(screen.getByTestId("monitor-weather").textContent).toContain("stored history");
    expect(screen.getByTestId("monitor-run-cycle")).toBeTruthy();
    expect(screen.queryByTestId("monitor-fetch-weather")).toBeNull();
  });

  it("runs a cycle and a weather fetch for admins, showing the result inline", async () => {
    const runMonitorCycle = vi.fn(() => Promise.resolve({ last_run_at: null, last_status: "OK" as const, last_error: null, duration_s: 4.02, result: { scored: 2798 }, weather: null, weather_error: null }));
    const ingestWeather = vi.fn(() => Promise.resolve({ provider: "open-meteo", points: 9, observations: 27980, forecasts: 8394, observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast", is_imd: false }));
    const onChanged = vi.fn();
    render(<MonitoringPanel client={fakeClient({ runMonitorCycle, ingestWeather })} mode={liveMonitor()} sources={weatherSources} isAdmin onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId("monitor-run-cycle"));
    expect((await screen.findByTestId("monitor-action-result")).textContent).toContain("Cycle OK in 4.02 s · 2798 cells scored");
    fireEvent.click(screen.getByTestId("monitor-fetch-weather"));
    await waitFor(() => expect(screen.getByTestId("monitor-action-result").textContent).toContain("27980 observations"));
    expect(screen.getByTestId("monitor-action-result").textContent).toContain("(non-IMD)");
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows the backend error when a manual cycle fails", async () => {
    const runMonitorCycle = vi.fn(() => Promise.reject(new ApiError(500, "INTERNAL_ERROR", "weather provider unreachable")));
    render(<MonitoringPanel client={fakeClient({ runMonitorCycle })} mode={liveMonitor()} sources={weatherSources} isAdmin onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId("monitor-run-cycle"));
    expect((await screen.findByTestId("error-box")).textContent).toContain("weather provider unreachable");
  });
});

describe("audit trail", () => {
  it("distinguishes an automatic system action from a human approval", async () => {
    const auditEvents = vi.fn(() =>
      Promise.resolve({
        items: [
          { id: 18, at: "2026-09-18T06:00:00Z", action: "ALERT_AUTO_DISPATCHED", entity_type: "alert", entity_id: "al-1", details: { lead_time_h: 0 }, actor: null },
          { id: 19, at: "2026-09-18T06:05:00Z", action: "ALERT_APPROVED", entity_type: "alert", entity_id: "al-1", details: {}, actor: { id: "u1", full_name: "Demo District Authority", role: "DISTRICT_AUTHORITY" as const } },
        ],
        note: "An actor of null means the system acted automatically.",
      }),
    );
    render(<AuditTrail client={fakeClient({ auditEvents })} entityType="alert" entityId="al-1" />);
    const events = await screen.findAllByTestId("audit-event");
    expect(events).toHaveLength(2);
    expect(events[0].getAttribute("data-actor")).toBe("system");
    expect(events[0].textContent).toContain("Alert auto dispatched by the system (automatic)");
    expect(events[1].getAttribute("data-actor")).toBe("user");
    expect(events[1].textContent).toContain("by Demo District Authority (District authority)");
    expect(screen.getByText(/actor of null means the system acted automatically/)).toBeTruthy();
    expect(auditEvents).toHaveBeenCalledWith("alert", "al-1", expect.anything());
  });

  it("shows an empty trail honestly", async () => {
    render(<AuditTrail client={fakeClient({ auditEvents: () => Promise.resolve({ items: [] }) })} entityType="report" entityId="rp-1" />);
    expect((await screen.findByTestId("empty-audit")).textContent).toBe("No recorded actions yet");
  });
});

const landcoverCollection = {
  type: "FeatureCollection" as const,
  metadata: {
    source_slug: "esa-worldcover-2021",
    dataset: "ESA WorldCover 10 m 2021 v200 (Sentinel-1 + Sentinel-2 derived land cover)",
    connection_status: "CONNECTED_HISTORICAL" as const,
    acquisition_start: "2021-01-01",
    acquisition_end: "2021-12-31",
    acquisition_note: null,
    attribution: "© ESA WorldCover project 2021",
    provenance: "REAL_HISTORICAL" as const,
    class_labels: { "10": "Tree cover", "30": "Grassland", "50": "Built-up" },
    note: "Majority land-cover class per analysis cell, as used by the risk model. Not an image.",
  },
  features: [
    { type: "Feature" as const, id: "c1", geometry: { type: "Polygon" as const, coordinates: [[[92.6, 23.6] as [number, number], [92.61, 23.6] as [number, number], [92.61, 23.61] as [number, number], [92.6, 23.6] as [number, number]]] }, properties: { grid_code: "AIZ-0000-0000", landcover_class: 10, landcover_label: "Tree cover", landcover_tree_share: 0.871, provenance: "REAL_HISTORICAL" as const } },
    { type: "Feature" as const, id: "c2", geometry: { type: "Polygon" as const, coordinates: [[[92.6, 23.6] as [number, number], [92.61, 23.6] as [number, number], [92.61, 23.61] as [number, number], [92.6, 23.6] as [number, number]]] }, properties: { grid_code: "AIZ-0000-0001", landcover_class: 50, landcover_label: "Built-up", landcover_tree_share: 0.02, provenance: "REAL_HISTORICAL" as const } },
    { type: "Feature" as const, id: "c3", geometry: { type: "Polygon" as const, coordinates: [[[92.6, 23.6] as [number, number], [92.61, 23.6] as [number, number], [92.61, 23.61] as [number, number], [92.6, 23.6] as [number, number]]] }, properties: { grid_code: "AIZ-0000-0002", landcover_class: 50, landcover_label: "Built-up", landcover_tree_share: 0.01, provenance: "REAL_HISTORICAL" as const } },
  ],
};

describe("land cover layer", () => {
  it("legends the classes present with counts, the acquisition range and the attribution", () => {
    render(<LandcoverLegend landcover={landcoverCollection} />);
    const classes = screen.getAllByTestId("landcover-class");
    expect(classes.map((c) => c.getAttribute("data-class"))).toEqual(["50", "10"]); // most common first
    expect(classes[0].textContent).toContain("Built-up");
    expect(classes[0].textContent).toContain("2");
    expect(classes[1].textContent).toContain("Tree cover");
    expect(screen.getByTestId("landcover-acquisition").textContent).toBe("Acquisition: 2021-01-01 to 2021-12-31");
    expect(screen.getByTestId("landcover-attribution").textContent).toContain("ESA WorldCover");
    expect(screen.getByText(/Not an image/)).toBeTruthy();
  });

  it("falls back to the acquisition note when no range is reported", () => {
    const meta = { ...landcoverCollection.metadata, acquisition_start: null, acquisition_end: null, acquisition_note: "Source records no acquisition range" };
    render(<LandcoverLegend landcover={{ ...landcoverCollection, metadata: meta }} />);
    expect(screen.getByTestId("landcover-acquisition").textContent).toContain("Source records no acquisition range");
  });

  it("shows an empty state for an area with no classes", () => {
    render(<LandcoverLegend landcover={{ ...landcoverCollection, features: [] }} />);
    expect(screen.getByTestId("landcover-empty")).toBeTruthy();
  });

  it("puts the cell's land-cover class in the cell panel, worded as derived, not imagery", () => {
    render(
      <CellDetail
        detail={detail("c1", assessment(0))}
        landcover={landcoverCollection.features[0].properties}
        landcoverMeta={landcoverCollection.metadata}
      />,
    );
    const line = screen.getByTestId("cell-landcover");
    expect(line.textContent).toContain("Tree cover");
    expect(line.textContent).toContain("tree cover 87%");
    expect(line.textContent).toContain("satellite-derived class, not imagery (2021-01-01 to 2021-12-31)");
  });
});

const rainfallSeries = {
  risk_zone_id: "c1",
  run_mode: "DEMO_REPLAY" as const,
  as_of: "2017-06-14T00:00:00Z",
  observed: [
    { period_start: "2017-06-12T00:00:00Z", period_end: "2017-06-13T00:00:00Z", rainfall_mm: 44.5, provenance: "REAL_HISTORICAL" as const, source: "imd-gridded-rainfall" },
    { period_start: "2017-06-13T00:00:00Z", period_end: "2017-06-14T00:00:00Z", rainfall_mm: 191.5, provenance: "REAL_HISTORICAL" as const, source: "imd-gridded-rainfall" },
  ],
  forecast: [
    { issue_time: "2017-06-14T00:00:00Z", valid_start: "2017-06-14T00:00:00Z", valid_end: "2017-06-15T00:00:00Z", lead_time_h: 24, rainfall_mm: 10.19, provenance: "SIMULATED_DEMO" as const, source: "replay-forecast" },
  ],
};

describe("rainfall evidence", () => {
  it("draws observed and forecast bars and labels sources and provenance", async () => {
    const zoneRainfall = vi.fn(() => Promise.resolve(rainfallSeries));
    render(<RainfallStrip client={fakeClient({ zoneRainfall })} cellId="c1" />);
    const bars = await screen.findByTestId("rainfall-bars");
    expect(bars.getAttribute("data-bars")).toBe("3");
    expect(bars.querySelectorAll('[data-kind="observed"]').length).toBe(2);
    expect(bars.querySelectorAll('[data-kind="forecast"]').length).toBe(1);
    expect(bars.getAttribute("aria-label")).toContain("2 observed days");
    const observed = screen.getByTestId("rainfall-observed");
    expect(observed.textContent).toContain("imd-gridded-rainfall");
    expect(within(observed).getByTestId("provenance-badge").textContent).toContain("REAL_HISTORICAL");
    expect(observed.textContent).toContain("replayed");
    const forecast = screen.getByTestId("rainfall-forecast");
    expect(forecast.textContent).toContain("replay-forecast");
    expect(within(forecast).getByTestId("provenance-badge").textContent).toContain("SIMULATED_DEMO");
  });

  it("shows an empty state when no series is recorded", async () => {
    render(<RainfallStrip client={fakeClient({ zoneRainfall: () => Promise.resolve({ ...rainfallSeries, observed: [], forecast: [] }) })} cellId="c1" />);
    expect((await screen.findByTestId("rainfall-empty")).textContent).toBe("No rainfall series recorded for this cell yet");
  });

  it("shows an error with Retry when the series cannot be loaded", async () => {
    render(<RainfallStrip client={fakeClient({ zoneRainfall: () => Promise.reject(new ApiError(503, "UPSTREAM_UNAVAILABLE", "database unavailable")) })} cellId="c1" />);
    expect((await screen.findByTestId("error-box")).textContent).toContain("database unavailable");
    expect(screen.getByTestId("retry")).toBeTruthy();
  });
});

describe("weather throttling and last success", () => {
  it("shows a reused fetch as data fetched earlier, not as an error", () => {
    const mode = liveMonitor({
      weather: { provider: "open-meteo", is_imd: false, skipped: "fetched recently", min_interval_s: 3600, observations: 0, forecasts: 0, last_fetch_at: "2026-09-18T05:04:00Z", observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast" },
    });
    render(<MonitoringPanel client={fakeClient({})} mode={mode} sources={weatherSources} isAdmin={false} onChanged={() => {}} />);
    expect(screen.getByTestId("monitor-weather").textContent).toContain("Using data fetched at 05:04 UTC");
    expect(screen.getByTestId("monitor-weather-counts").textContent).toContain("No new rows in the last cycle");
    expect(screen.queryByTestId("monitor-weather-error")).toBeNull();
  });

  it("uses the API's last_success_at for the staleness warning", () => {
    const mode = liveMonitor({ last_status: "FAILED", last_error: "provider timeout", last_success_at: "2026-09-18T05:40:00Z", last_run_at: new Date().toISOString() });
    render(<MonitoringPanel client={fakeClient({})} mode={mode} sources={weatherSources} isAdmin={false} onChanged={() => {}} />);
    expect(screen.getByTestId("monitor-last-success").textContent).toContain("2026-09-18 05:40 UTC");
    expect(monitorView(mode, new Date()).warning?.text).toContain("Last successful cycle");
  });
});
