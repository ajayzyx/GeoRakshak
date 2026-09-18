import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SystemStatusPanel } from "./SystemStatusPanel";
import type { ApiClient } from "../api/client";
import { EFFECTIVE_LABELS, type StatusAdapter, type SystemStatus } from "../api/types";
import type { Polled } from "../lib/usePolling";
import { loggedInMockClient } from "../test/fakeClient";

const row = (over: Partial<StatusAdapter> & Pick<StatusAdapter, "slug" | "kind" | "connection_status" | "effective_label">): StatusAdapter => ({ age_s: null, is_imd: false, ...over });

// One adapter per display label, so every badge renders at least once.
const ADAPTERS: SystemStatus["adapters"] = {
  weather: [
    row({ slug: "open-meteo-recent", kind: "WEATHER_HISTORICAL", provider: "Open-Meteo (free API)", dataset: "Model-derived recent precipitation", connection_status: "CONNECTED_LIVE", effective_label: "REAL_LIVE", age_s: 240, verification_status: "UNVERIFIED", status_note: "Model output, not gauge observations. Non-IMD source (H16)." }),
    row({ slug: "imd-gridded-rainfall", kind: "WEATHER_HISTORICAL", provider: "IMD Pune", dataset: "IMD 0.25° daily gridded rainfall", connection_status: "CONNECTED_HISTORICAL", effective_label: "REAL_REPLAY", is_imd: true, age_s: 8945, verification_status: "VERIFIED", licence: "No open licence found … should not be reproduced anywhere without prior permission." }),
    row({ slug: "imd-weather-api", kind: "WEATHER_LIVE", provider: "IMD", dataset: "IMD weather API", connection_status: "AWAITING_ACCESS", effective_label: "AWAITING_ACCESS", is_imd: true, status_note: "Access request pending. No live IMD data in use." }),
    row({ slug: "replay-forecast", kind: "WEATHER_FORECAST", dataset: "Replay scenario forecast", connection_status: "SIMULATED", effective_label: "SIMULATED" }),
  ],
  inventory: [row({ slug: "gsi-bhusanket", kind: "INVENTORY", dataset: "GSI Bhusanket landslide inventory", connection_status: "CONNECTED_HISTORICAL", effective_label: "REAL_HISTORICAL", age_s: 3432, verification_status: "VERIFIED", licence: "GSI Bhusanket Terms of Use … PERMISSION IS REQUIRED before any redistribution or public display." })],
  satellite: [row({ slug: "sentinel2-composite", kind: "SATELLITE_LAYER", dataset: "Sentinel-2 NDVI composite (planned)", connection_status: "NOT_CONNECTED", effective_label: "NOT_CONNECTED", licence: "Not checked" })],
  notification: [row({ slug: "sms-channel", kind: "NOTIFICATION_CHANNEL", dataset: "SMS", connection_status: "SANDBOX", effective_label: "SANDBOX", status_note: "Messages rendered and logged, not sent" })],
};

const STATUS: SystemStatus = {
  run_mode: "LIVE",
  replay: null,
  monitor: {
    enabled: true,
    interval_s: 180,
    weather_provider: "open-meteo",
    last_run_at: new Date(Date.now() - 60_000).toISOString(),
    last_success_at: new Date(Date.now() - 60_000).toISOString(),
    last_status: "OK",
    last_error: null,
    next_run_at: new Date(Date.now() + 120_000).toISOString(),
    result: { scored: 2798 },
    weather: { provider: "open-meteo", is_imd: false, observed_source: "open-meteo-recent", forecast_source: "open-meteo-forecast", observations: 27980, forecasts: 8394, points: 9 },
    weather_error: null,
  },
  pilot: { slug: "aizawl-mizoram", name: "Aizawl, Mizoram (provisional pilot)", status: "PROVISIONAL" },
  model: { version: "b0-rules-0.1.0", model_type: "RULE_BASED_INDEX", stage: "B0_BASELINE", calibrated: false, validated: false, metrics: null, validation_scheme: "NONE - rule-based heuristic", forecast_skill_evaluated: false, model_card_uri: null },
  adapters: ADAPTERS,
  label_counts: { REAL_LIVE: 1, REAL_REPLAY: 1, REAL_HISTORICAL: 1, SIMULATED: 1, SANDBOX: 1, AWAITING_ACCESS: 1, NOT_CONNECTED: 1 },
  labels: {
    REAL_LIVE: "Connected to a real source now; freshness shown",
    REAL_REPLAY: "Real archived data replayed through the system for the demo",
    REAL_HISTORICAL: "Real archived data from a documented source",
    SIMULATED: "Synthetic data created by the team; never used for training or metrics",
    SANDBOX: "Rendered and logged, not sent",
    AWAITING_ACCESS: "Adapter exists; access requested, not granted",
    NOT_CONNECTED: "Adapter exists; nothing connected",
  },
  disclaimer: "Decision-support risk estimate. Not an official warning.",
  as_of: "2026-09-18T06:00:00Z",
};

const polled = (data: SystemStatus | null, over: Partial<Polled<SystemStatus>> = {}): Polled<SystemStatus> => ({
  data,
  error: null,
  loading: data === null,
  updatedAt: data ? new Date() : null,
  stale: false,
  refresh: vi.fn(),
  ...over,
});

const client = {} as ApiClient;

describe("SystemStatusPanel", () => {
  it("renders nothing while closed and opens as a dialog", () => {
    const { rerender } = render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("system-status")).toBeNull();
    rerender(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "System status" })).toBeTruthy();
  });

  it("shows the counts line, mode, replay/pilot details and the model's no-accuracy caveat", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    expect(screen.getByTestId("status-counts").textContent).toBe("1 real live · 1 real replay · 1 real historical · 1 simulated · 1 sandbox · 1 awaiting access · 1 not connected");
    expect(screen.getByTestId("status-run-mode").textContent).toBe("LIVE");
    expect(screen.getByTestId("status-pilot").textContent).toContain("Aizawl, Mizoram (provisional pilot)");
    expect(within(screen.getByTestId("status-pilot")).getByText("PROVISIONAL")).toBeTruthy();
    expect(screen.getByTestId("status-mode").textContent).toContain("not validated — no accuracy claim");
  });

  it("shows REPLAY with the step and date when replaying", () => {
    const replaying: SystemStatus = { ...STATUS, run_mode: "DEMO_REPLAY", replay: { scenario: "pilot-rainfall-replay", provenance: "REAL_HISTORICAL", step: 29, steps: 47, as_of: "2017-06-14T00:00:00+00:00" } };
    render(<SystemStatusPanel client={client} status={polled(replaying)} isAdmin={false} open onClose={() => {}} />);
    expect(screen.getByTestId("status-run-mode").textContent).toBe("REPLAY");
    expect(screen.getByTestId("status-replay").textContent).toBe("Step 29/46 · 2017-06-14 · replay data REAL_HISTORICAL");
  });

  it("embeds the scheduler block with last run, last success and next run", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    const scheduler = within(screen.getByTestId("status-scheduler"));
    expect(scheduler.getByTestId("monitor-scheduler").textContent).toContain("Scheduler LIVE");
    expect(scheduler.getByTestId("monitor-last-success")).toBeTruthy();
    expect(scheduler.getByTestId("monitor-next-run").textContent).toContain("in 2 min");
  });

  it("states IMD versus fallback in the weather headline", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    expect(screen.getByTestId("weather-headline").textContent).toBe("Open-Meteo — non-IMD fallback; IMD API awaiting access");
  });

  it("groups sources in the judge-facing order, with an explicit empty group", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    const groups = screen.getAllByTestId("status-group");
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["imd-weather", "weather-fallback", "satellite", "sensor", "inventory", "terrain", "exposure", "notification"]);
    const imd = within(groups[0]);
    expect(imd.getAllByTestId("status-adapter").map((r) => r.getAttribute("data-slug"))).toEqual(["imd-gridded-rainfall", "imd-weather-api"]);
    expect(within(groups[1]).getAllByTestId("status-adapter").map((r) => r.getAttribute("data-slug"))).toEqual(["open-meteo-recent", "replay-forecast"]);
    expect(within(groups[3]).getByTestId("status-group-empty").textContent).toBe("Nothing registered in this group.");
    expect(within(groups[5]).getByTestId("status-group-empty")).toBeTruthy();
  });

  it("renders every one of the seven labels as a badge on a row and in the legend", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    const rowLabels = screen.getAllByTestId("status-adapter").map((r) => r.getAttribute("data-label"));
    for (const label of EFFECTIVE_LABELS) expect(rowLabels).toContain(label);
    const legend = screen.getAllByTestId("label-legend-item");
    expect(legend.map((l) => l.getAttribute("data-label"))).toEqual([...EFFECTIVE_LABELS]);
    expect(legend[1].textContent).toContain("Real archived data replayed through the system for the demo");
    expect(legend[4].textContent).toContain("Rendered and logged, not sent");
  });

  it("shows freshness per row and the status note on hover", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    const rows = Object.fromEntries(screen.getAllByTestId("status-adapter").map((r) => [r.getAttribute("data-slug"), r]));
    expect(within(rows["open-meteo-recent"]).getByTestId("status-freshness").textContent).toBe("updated 4 min ago");
    expect(within(rows["imd-gridded-rainfall"]).getByTestId("status-freshness").textContent).toBe("updated 2 h 29 min ago");
    expect(within(rows["imd-weather-api"]).getByTestId("status-freshness").textContent).toBe("never");
    expect(rows["imd-weather-api"].getAttribute("title")).toBe("Access request pending. No live IMD data in use.");
    expect(rows["open-meteo-recent"].textContent).toContain("unverified");
  });

  it("marks licence-restricted sources and leaves open ones unmarked", () => {
    render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    const rows = Object.fromEntries(screen.getAllByTestId("status-adapter").map((r) => [r.getAttribute("data-slug"), r]));
    expect(within(rows["imd-gridded-rainfall"]).getByTestId("licence-marker").textContent).toBe("permission required for publication");
    expect(within(rows["gsi-bhusanket"]).getByTestId("licence-marker").textContent).toBe("permission required for publication");
    expect(within(rows["sentinel2-composite"]).getByTestId("licence-marker").textContent).toBe("licence not checked");
    expect(within(rows["open-meteo-recent"]).queryByTestId("licence-marker")).toBeNull();
  });

  it("shows admin controls only for admins", () => {
    const { rerender } = render(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={() => {}} />);
    expect(screen.queryByTestId("monitor-run-cycle")).toBeNull();
    rerender(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin open onClose={() => {}} />);
    expect(screen.getByTestId("monitor-run-cycle")).toBeTruthy();
  });

  it("shows a loading state, then closes on the button and on Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(<SystemStatusPanel client={client} status={polled(null)} isAdmin={false} open onClose={onClose} />);
    expect(screen.getByTestId("loading")).toBeTruthy();
    rerender(<SystemStatusPanel client={client} status={polled(STATUS)} isAdmin={false} open onClose={onClose} />);
    fireEvent.click(screen.getByTestId("close-system-status"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("mock fixture: nothing is REAL_LIVE except the in-app inbox, and every label text is provided", async () => {
    const mock = await loggedInMockClient();
    const status = await mock.systemStatus();
    const live = Object.values(status.adapters).flat().filter((a) => a?.effective_label === "REAL_LIVE").map((a) => a!.slug);
    expect(live).toEqual(["app-inbox-channel"]);
    for (const label of EFFECTIVE_LABELS) expect(status.labels[label]).toBeTruthy();
    render(<SystemStatusPanel client={mock} status={polled(status)} isAdmin={false} open onClose={() => {}} />);
    expect(screen.getByTestId("status-run-mode").textContent).toBe("REPLAY");
    expect(screen.getByTestId("status-replay").textContent).toBe("Replay not started");
  });
});
