import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { DataSource, MonitorResult, MonitorWeather, SystemMode } from "../api/types";
import { fmtTime } from "../lib/format";
import { fmtRelative, monitorView, weatherView, type MonitorView } from "../lib/monitor";
import { ConnectionBadge } from "./Badges";
import { ErrorBox } from "./ErrorBox";
import { Spinner } from "./ResourceStatus";

/** Re-renders on a timer so "in 2 min" stays true between /system/mode polls. */
function useNow(intervalMs = 10_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const HEALTH_LABEL: Record<MonitorView["health"], string> = {
  OK: "LIVE",
  FAILED: "FAILED",
  STALE: "OVERDUE",
  STOPPED: "STOPPED",
  NEVER_RUN: "NO CYCLE YET",
  NO_SCHEDULER: "NO SCHEDULER",
  UNKNOWN: "UNKNOWN",
};

/** Compact always-visible scheduler state for the header. */
export function SchedulerChip({ mode }: { mode: SystemMode | null }) {
  const now = useNow();
  const view = monitorView(mode, now);
  if (view.health === "UNKNOWN") return null;
  const extra =
    view.health === "NO_SCHEDULER"
      ? "cycles on replay steps"
      : view.lastRunAt
        ? `cycle ${fmtRelative(view.lastRunAt, now)}`
        : "no cycle yet";
  return (
    <span className={`badge health health-${view.health.toLowerCase()}`} data-testid="scheduler-chip" data-health={view.health} title={view.detail}>
      {HEALTH_LABEL[view.health]} · {extra}
    </span>
  );
}

/** Prominent warning shown next to the risk map when the cycle failed, stopped or went overdue. */
export function MonitorWarning({ view }: { view: MonitorView }) {
  if (!view.warning) return null;
  return (
    <div className={`monitor-warning ${view.health.toLowerCase()}`} role="alert" data-testid="monitor-warning" data-health={view.health}>
      <strong>{view.warning.title}</strong>
      <div className="small">{view.warning.text}</div>
    </div>
  );
}

function ResultLine({ result }: { result: MonitorResult | null }) {
  if (!result) return null;
  const closed = Array.isArray(result.watches_auto_closed) ? result.watches_auto_closed.length : (result.watches_auto_closed ?? 0);
  const created = [
    result.watch_created ? "watch" : null,
    result.forecast_watch_created ? "forecast watch" : null,
    result.warning_draft_created ? "warning draft" : null,
  ].filter(Boolean);
  return (
    <div className="small" data-testid="monitor-result">
      Last cycle: {result.scored ?? "?"} cells scored{result.model_version ? ` with ${result.model_version}` : ""} · {result.roads_at_risk ?? 0} roads at risk ·{" "}
      {result.villages_access_at_risk ?? 0} villages with access at risk
      {created.length > 0 ? ` · created ${created.join(", ")}` : " · no new alerts"}
      {closed ? ` · ${closed} watch(es) auto-closed` : ""}
    </div>
  );
}

function WeatherBlock({ monitor, sources }: { monitor: SystemMode["monitor"]; sources: DataSource[] | null }) {
  const w = weatherView(monitor, sources);
  return (
    <div data-testid="monitor-weather" data-provider={w.provider} data-connected={w.connected ? "true" : "false"}>
      <h4>Weather provider</h4>
      <div className="small">
        <strong data-testid="monitor-weather-provider">{w.providerLabel}</strong>
        {w.connected && <span className={`badge ${monitor?.weather?.is_imd ? "imd" : "non-imd"}`} data-testid="monitor-weather-imd">{w.imdLabel}</span>}
      </div>
      <div className="small muted">{w.detail}</div>
      <div className="small" data-testid="monitor-weather-counts">{w.counts ?? (w.connected ? "No ingest counts reported yet" : "")}</div>
      {w.rows.length > 0 && (
        <ul className="plain">
          {w.rows.map((row) => (
            <li key={row.role} className="small" data-testid={`weather-row-${row.role.toLowerCase()}`}>
              {row.role}: {row.slug ? <code>{row.slug}</code> : <span className="muted">source slug not reported by the API</span>}{" "}
              {row.source ? (
                <ConnectionBadge status={row.source.connection_status} />
              ) : row.slug ? (
                <span className="muted">not in the status registry</span>
              ) : null}
              {row.source?.status_note && <div className="muted clamp" title={row.source.status_note}>{row.source.status_note}</div>}
            </li>
          ))}
        </ul>
      )}
      {w.error && (
        <div className="error-box small" role="alert" data-testid="monitor-weather-error">
          Weather ingest error: {w.error}
        </div>
      )}
    </div>
  );
}

interface Props {
  client: ApiClient;
  mode: SystemMode | null;
  sources: DataSource[] | null;
  isAdmin: boolean;
  /** Refetch everything after a manual cycle or ingest. */
  onChanged: () => void;
  /** Rendered inside another panel (the System status drawer): no own panel frame. */
  embedded?: boolean;
}

export function MonitoringPanel({ client, mode, sources, isAdmin, onChanged, embedded = false }: Props) {
  const now = useNow();
  const view = monitorView(mode, now);
  const monitor = mode?.monitor ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canRunCycle = isAdmin && mode?.run_mode === "LIVE";
  const canFetchWeather = isAdmin && !!monitor?.weather_provider && monitor.weather_provider !== "none";

  async function run(label: string, fn: () => Promise<unknown>, describe: (r: unknown) => string) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      setMessage(describe(await fn()));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  const Wrapper = embedded ? "div" : "section";
  return (
    <Wrapper className={embedded ? undefined : "panel"} data-testid="monitoring-panel">
      <h3>{embedded ? "Scheduler" : "Monitoring cycle"}</h3>
      <div className="small" data-testid="monitor-scheduler" data-health={view.health}>
        <span className={`badge health health-${view.health.toLowerCase()}`}>{HEALTH_LABEL[view.health]}</span> {view.headline}
        {view.intervalLabel ? ` · ${view.intervalLabel}` : ""}
      </div>
      <div className="small muted" data-testid="monitor-detail">{view.detail}</div>
      {view.health !== "NO_SCHEDULER" && (
        <dl className="kv compact">
          <dt>Last run</dt>
          <dd data-testid="monitor-last-run">
            {view.lastRunAt ? `${fmtTime(monitor?.last_run_at)} (${fmtRelative(view.lastRunAt, now)})` : "never"}
            {monitor?.last_status ? ` · ${monitor.last_status}` : ""}
          </dd>
          <dt>Last success</dt>
          <dd data-testid="monitor-last-success">
            {view.lastSuccessAt ? `${fmtTime(monitor?.last_success_at ?? monitor?.last_run_at)} (${fmtRelative(view.lastSuccessAt, now)})` : "none recorded"}
          </dd>
          <dt>Next run</dt>
          <dd data-testid="monitor-next-run">{view.nextRunAt ? `${fmtRelative(view.nextRunAt, now)} · ${fmtTime(monitor?.next_run_at)}` : "not scheduled"}</dd>
        </dl>
      )}
      {monitor?.last_error && (
        <div className="error-box small" role="alert" data-testid="monitor-last-error">
          Cycle error: {monitor.last_error}
        </div>
      )}
      <ResultLine result={monitor?.result ?? null} />
      <WeatherBlock monitor={monitor} sources={sources} />
      {(canRunCycle || canFetchWeather) && (
        <div className="button-row">
          {canRunCycle && (
            <button
              disabled={!!busy}
              data-testid="monitor-run-cycle"
              onClick={() =>
                void run("Running cycle", () => client.runMonitorCycle({ timeoutMs: 120_000 }), (r) => {
                  const res = r as { last_status?: string; duration_s?: number | null; result?: MonitorResult | null };
                  return `Cycle ${res.last_status ?? "finished"}${res.duration_s ? ` in ${res.duration_s} s` : ""} · ${res.result?.scored ?? "?"} cells scored`;
                })
              }
            >
              Run cycle now
            </button>
          )}
          {canFetchWeather && (
            <button
              disabled={!!busy}
              data-testid="monitor-fetch-weather"
              onClick={() =>
                void run("Fetching weather", () => client.ingestWeather({ timeoutMs: 120_000 }), (r) => {
                  const w = r as MonitorWeather;
                  return `Fetched from ${w.provider}: ${w.observations ?? 0} observations, ${w.forecasts ?? 0} forecast rows${w.is_imd ? " (IMD)" : " (non-IMD)"}`;
                })
              }
            >
              Fetch weather now
            </button>
          )}
        </div>
      )}
      {busy && <Spinner label={`${busy}…`} />}
      {error !== null && <ErrorBox error={error} context="Monitoring action" />}
      {message && <div className="success small" role="status" data-testid="monitor-action-result">{message}</div>}
    </Wrapper>
  );
}
