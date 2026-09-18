import { useEffect } from "react";
import type { ApiClient } from "../api/client";
import type { EffectiveLabel, StatusAdapter, SystemMode, SystemStatus } from "../api/types";
import { EFFECTIVE_LABELS } from "../api/types";
import { fmtTime } from "../lib/format";
import { formatReplayStep } from "../lib/replay";
import { LABEL_TEXT, LICENCE_MARKER_TEXT, countsSummary, freshness, groupAdapters, labelTone, licenceMarker, weatherSummary } from "../lib/systemStatus";
import type { Polled } from "../lib/usePolling";
import { MonitoringPanel } from "./MonitoringPanel";
import { ResourceStatus, StaleBadge } from "./ResourceStatus";

/** Badge in the seven-value display vocabulary; the tone matches the "Data in this view" strip. */
export function EffectiveLabelBadge({ label }: { label: EffectiveLabel | string }) {
  const tone = labelTone(label);
  const known = (EFFECTIVE_LABELS as readonly string[]).includes(label);
  return (
    <span className={`badge effective tone-${tone}`} data-testid="effective-label" data-label={label} title={known ? LABEL_TEXT[label as EffectiveLabel] : `Unrecognised label: ${label}`}>
      <span className="strip-tag">{label}</span>
    </span>
  );
}

function AdapterRow({ adapter }: { adapter: StatusAdapter }) {
  const marker = licenceMarker(adapter.licence);
  const name = adapter.dataset?.trim() || adapter.provider?.trim() || adapter.slug;
  return (
    <li className="status-row" data-testid="status-adapter" data-slug={adapter.slug} data-label={adapter.effective_label} title={adapter.status_note ?? undefined}>
      <div className="status-row-head">
        <EffectiveLabelBadge label={adapter.effective_label} />
        <span className="status-name">{name}</span>
        {adapter.is_imd && <span className="badge imd">IMD</span>}
      </div>
      <div className="small muted status-row-meta">
        <code>{adapter.slug}</code> · {adapter.verification_status ? adapter.verification_status.toLowerCase() : "verification not reported"} ·{" "}
        <span data-testid="status-freshness">{freshness(adapter)}</span>
        {marker && (
          <>
            {" "}
            · <span className="badge licence" data-testid="licence-marker" data-marker={marker} title={adapter.licence ?? undefined}>{LICENCE_MARKER_TEXT[marker]}</span>
          </>
        )}
      </div>
      {(adapter.status_note || adapter.licence || adapter.last_error) && (
        <details className="small">
          <summary className="muted">details</summary>
          {adapter.status_note && <div>{adapter.status_note}</div>}
          {adapter.provider && <div className="muted">Provider: {adapter.provider}</div>}
          {adapter.licence && <div className="muted">Licence: {adapter.licence}</div>}
          {adapter.attribution_text && <div className="muted">Attribution: {adapter.attribution_text}</div>}
          {adapter.last_error && <div className="warn-text">Last error: {adapter.last_error}</div>}
        </details>
      )}
    </li>
  );
}

interface Props {
  client: ApiClient;
  status: Polled<SystemStatus>;
  isAdmin: boolean;
  open: boolean;
  onClose: () => void;
}

/** One judge-facing view of what is real, replayed, simulated, sandboxed or missing right now. */
export function SystemStatusPanel({ client, status, isAdmin, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const s = status.data;
  const mode: SystemMode | null = s ? { run_mode: s.run_mode, replay: s.replay, monitor: s.monitor } : null;
  const weather = weatherSummary(s);
  const groups = s ? groupAdapters(s.adapters) : [];

  return (
    <div className="drawer-backdrop" onClick={onClose} data-testid="system-status-backdrop">
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="System status" data-testid="system-status" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>System status</h2>
          <button type="button" onClick={onClose} data-testid="close-system-status">Close</button>
        </header>
        <ResourceStatus resource={status} label="system status" />
        {s && (
          <div className="drawer-body">
            <div className="counts-line" data-testid="status-counts">{countsSummary(s.label_counts) || "No adapters reported"}</div>

            <section data-testid="status-mode">
              <h3>Mode</h3>
              <div className="status-mode-line">
                <span className={`badge run-mode ${s.run_mode === "LIVE" ? "run-live" : "run-replay"}`} data-testid="status-run-mode">{s.run_mode === "LIVE" ? "LIVE" : "REPLAY"}</span>
                {s.run_mode === "DEMO_REPLAY" && (
                  <span data-testid="status-replay">{s.replay ? `${formatReplayStep(s.replay)} · replay data ${s.replay.provenance}` : "Replay not started"}</span>
                )}
                {s.pilot ? (
                  <span data-testid="status-pilot">
                    Pilot: <strong>{s.pilot.name}</strong>
                    {s.pilot.status === "PROVISIONAL" && <span className="badge provisional">PROVISIONAL</span>}
                  </span>
                ) : (
                  <span className="muted">No pilot area loaded</span>
                )}
              </div>
              <div className="small muted">
                Model:{" "}
                {s.model ? (
                  <>
                    <code>{s.model.version}</code> · {s.model.stage}
                    {s.model.validated ? ` · validated (${s.model.validation_scheme ?? "scheme not reported"})` : " · not validated — no accuracy claim"}
                  </>
                ) : (
                  "no model registered"
                )}{" "}
                · status as of {fmtTime(s.as_of)} <StaleBadge resource={status} />
              </div>
            </section>

            <section data-testid="status-scheduler">
              <MonitoringPanel client={client} mode={mode} sources={groups.flatMap((g) => g.items)} isAdmin={isAdmin} onChanged={status.refresh} embedded />
            </section>

            <section data-testid="status-weather-summary">
              <h3>Weather in use</h3>
              <div className="weather-headline" data-testid="weather-headline">{weather.headline}</div>
              {weather.detail && <div className="small muted">{weather.detail}</div>}
            </section>

            <section data-testid="status-sources">
              <h3>Data sources</h3>
              {groups.map((g) => (
                <div key={g.key} className="status-group" data-testid="status-group" data-group={g.key}>
                  <h4>{g.title}</h4>
                  {g.items.length === 0 ? (
                    <p className="small muted" data-testid="status-group-empty">Nothing registered in this group.</p>
                  ) : (
                    <ul className="plain">
                      {g.items.map((a) => (
                        <AdapterRow key={a.slug} adapter={a} />
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </section>

            <section data-testid="status-legend">
              <h3>What the labels mean</h3>
              <ul className="plain label-legend">
                {EFFECTIVE_LABELS.map((l) => (
                  <li key={l} data-testid="label-legend-item" data-label={l}>
                    <EffectiveLabelBadge label={l} /> <span className="small">{s.labels[l] ?? "meaning not provided by the API"}</span>
                  </li>
                ))}
              </ul>
            </section>
            <p className="disclaimer">{s.disclaimer}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
