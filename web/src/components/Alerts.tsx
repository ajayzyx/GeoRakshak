import { useState } from "react";
import type { ApiClient } from "../api/client";
import type { Alert, AlertChannel, AlertsResponse, ApproveResponse, Delivery } from "../api/types";
import { usePolling, type Polled } from "../lib/usePolling";
import { fmtTime } from "../lib/format";
import { deliveryStatusLabel, humanize } from "../lib/labels";
import { severityColor, severityLabel } from "../lib/severity";
import { ProvenanceBadge } from "./Badges";
import { ErrorBox } from "./ErrorBox";
import { ResourceStatus } from "./ResourceStatus";
import { AuditTrail } from "./AuditTrail";

export function TierBadge({ alert }: { alert: Pick<Alert, "tier" | "status"> }) {
  const note =
    alert.tier === "WATCH" ? "internal · automatic" : alert.tier === "WARNING" ? "public · human approval required" : "update";
  return (
    <span className={`badge tier tier-${alert.tier.toLowerCase()}`} data-testid="alert-tier" data-tier={alert.tier}>
      {alert.tier} <span className="small">({note})</span>
    </span>
  );
}

interface ListProps {
  resource: Polled<AlertsResponse | null>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AlertList({ resource, selectedId, onSelect }: ListProps) {
  const alerts = resource.data?.items ?? null;
  if (!alerts) return <ResourceStatus resource={resource} label="alerts" />;
  if (alerts.length === 0) {
    return (
      <>
        <ResourceStatus resource={resource} label="alerts" />
        <p className="muted" data-testid="empty-alerts">No alerts</p>
      </>
    );
  }
  return (
    <>
    <ResourceStatus resource={resource} label="alerts" />
    <ul className="item-list" data-testid="alert-list">
      {alerts.map((a) => (
        <li key={a.id} className={a.id === selectedId ? "selected" : ""}>
          <button className="item" onClick={() => onSelect(a.id)} data-testid="alert-item" data-alert-id={a.id}>
            <div className="item-head">
              <TierBadge alert={a} />
              <span className="severity-pill small" style={{ background: severityColor(a.severity) }}>{severityLabel(a.severity)}</span>
            </div>
            <div className="item-sub">
              <strong>{humanize(a.status)}</strong> · {a.lead_time_h === 0 ? "current" : `+${a.lead_time_h} h`} · {a.dispatched_at ? `dispatched ${fmtTime(a.dispatched_at)}` : "not dispatched"}
              {a.is_demo && <span className="badge small">demo</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
    </>
  );
}

const CHANNELS: AlertChannel[] = ["APP_PUSH", "APP_INBOX", "SMS"];

interface DetailProps {
  client: ApiClient;
  alert: Alert;
  canAct: boolean;
  onChanged: () => void;
  onShowCell?: (id: string) => void;
}

export function AlertDetail({ client, alert, canAct, onChanged, onShowCell }: DetailProps) {
  const isDraftWarning = alert.status === "DRAFT" && alert.tier !== "WATCH";
  const [actions, setActions] = useState(alert.recommended_actions ?? "");
  const [validUntil, setValidUntil] = useState(alert.valid_until ?? "");
  const [languages, setLanguages] = useState<string[]>(alert.languages.filter((l) => !l.startsWith("<")));
  const [extraLang, setExtraLang] = useState("");
  const [channels, setChannels] = useState<AlertChannel[]>(CHANNELS);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApproveResponse | null>(null);
  const [delivVersion, setDelivVersion] = useState(0);

  const languageOptions = Array.from(new Set(["en", "hi", ...alert.languages.filter((l) => !l.startsWith("<")), ...languages]));

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(label);
      onChanged();
      setDelivVersion((v) => v + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function saveDraft() {
    const body = { recommended_actions: actions, ...(validUntil ? { valid_until: validUntil } : {}), languages };
    void run("Draft saved", () => client.patchAlert(alert.id, body));
  }

  function approve() {
    void run("Warning approved and dispatched", async () => {
      setApproval(await client.approveAlert(alert.id, { languages, channels, recommended_actions: actions || undefined, valid_until: validUntil || undefined }));
    });
  }

  return (
    <div className="alert-detail" aria-label="Alert detail">
      <h2>Alert</h2>
      <div className="badge-row">
        <TierBadge alert={alert} />
        <span className="badge">{alert.status}</span>
        <ProvenanceBadge provenance={alert.provenance} />
        {alert.is_demo && <span className="badge">demo</span>}
      </div>
      <dl className="kv">
        <dt>Severity</dt><dd>{severityLabel(alert.severity)}</dd>
        <dt>Trigger</dt><dd>{humanize(alert.trigger_type)}</dd>
        <dt>Lead time</dt><dd>{alert.lead_time_h === 0 ? "Current" : `Forecast +${alert.lead_time_h} h`}</dd>
        <dt>Risk zones</dt>
        <dd>{alert.risk_zone_ids.map((id) => onShowCell ? <button key={id} className="link" onClick={() => onShowCell(id)}>show cell</button> : <code key={id}>{id}</code>)}</dd>
        <dt>Languages</dt><dd>{alert.languages.join(", ")}</dd>
        <dt>Approved by</dt><dd>{alert.approved_by ? alert.approved_by.full_name : alert.tier === "WATCH" ? "Not applicable (automatic internal watch)" : "Not approved"}</dd>
        <dt>Dispatched</dt><dd>{fmtTime(alert.dispatched_at)}</dd>
        <dt>Run mode</dt><dd>{alert.run_mode}</dd>
        {alert.recommended_actions && !isDraftWarning && (<><dt>Recommended actions</dt><dd>{alert.recommended_actions}</dd></>)}
      </dl>
      {alert.explanation_snapshot.length > 0 && (
        <>
          <h3>Explanation snapshot</h3>
          <ul className="plain">{alert.explanation_snapshot.map((x, i) => <li key={i}><strong>{x.label}:</strong> {x.text}</li>)}</ul>
        </>
      )}

      {canAct && isDraftWarning && (
        <div className="card form">
          <h3>Review public warning (human approval required)</h3>
          <label>
            Recommended actions
            <textarea rows={3} value={actions} onChange={(e) => setActions(e.target.value)} />
          </label>
          <label>
            Valid until (ISO 8601 UTC)
            <input value={validUntil} onChange={(e) => setValidUntil(e.target.value)} placeholder="2026-07-15T06:00:00Z" />
          </label>
          <fieldset>
            <legend>Languages</legend>
            {languageOptions.map((l) => (
              <label key={l} className="inline"><input type="checkbox" checked={languages.includes(l)} onChange={() => setLanguages(toggle(languages, l))} /> {l}</label>
            ))}
            <span className="inline">
              <input className="short" value={extraLang} onChange={(e) => setExtraLang(e.target.value)} placeholder="pilot-area language code" />
              <button type="button" onClick={() => { const v = extraLang.trim(); if (v) { setLanguages(Array.from(new Set([...languages, v]))); setExtraLang(""); } }}>Add</button>
            </span>
          </fieldset>
          <fieldset>
            <legend>Channels</legend>
            {CHANNELS.map((c) => (
              <label key={c} className="inline"><input type="checkbox" checked={channels.includes(c)} onChange={() => setChannels(toggle(channels, c))} /> {c}{c === "SMS" ? " (see sms-channel status)" : ""}</label>
            ))}
          </fieldset>
          <div className="button-row">
            <button type="button" onClick={saveDraft} disabled={busy}>Save draft</button>
            <button type="button" className="primary" onClick={approve} disabled={busy || languages.length === 0 || channels.length === 0}>Approve &amp; dispatch</button>
          </div>
          <label>
            Rejection note
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this draft is rejected" />
          </label>
          <button type="button" className="danger" disabled={busy} onClick={() => void run("Draft rejected", () => client.rejectAlert(alert.id, note.trim()))}>Reject draft</button>
        </div>
      )}
      {canAct && ["AUTO_DISPATCHED", "APPROVED", "DISPATCHED"].includes(alert.status) && (
        <div className="card form">
          <h3>Close alert</h3>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Closing note" />
          <button type="button" disabled={busy} onClick={() => void run("Alert closed", () => client.closeAlert(alert.id, note.trim()))}>Close alert</button>
        </div>
      )}
      {error !== null && <ErrorBox error={error} context="Alert action failed" />}
      {message && <div className="success">{message}.</div>}
      {approval && <DeliverySummary summary={approval.delivery_summary} />}
      {alert.status !== "DRAFT" && <DeliveriesLog client={client} alertId={alert.id} version={delivVersion} />}
      <AuditTrail client={client} entityType="alert" entityId={alert.id} refreshKey={delivVersion} />
    </div>
  );
}

export function DeliverySummary({ summary }: { summary: ApproveResponse["delivery_summary"] }) {
  return (
    <div className="card">
      <h3>Delivery summary</h3>
      <ul className="plain">
        {Object.entries(summary).map(([channel, counts]) => (
          <li key={channel}>
            <code>{channel}</code>:{" "}
            {Object.entries(counts).map(([status, n]) => `${deliveryStatusLabel(status, "").text} ×${n}`).join(", ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DeliveriesLog({ client, alertId, version }: { client: ApiClient; alertId: string; version: number }) {
  const { data, error, refresh } = usePolling((signal) => client.deliveries(alertId, { signal }), null, [alertId], version);
  return (
    <div>
      <h3>Deliveries log <button className="link" onClick={refresh}>refresh</button></h3>
      {error && !data ? <ErrorBox error={error} context="Deliveries" onRetry={refresh} /> : !data ? <p className="muted">Loading…</p> : <DeliveryTable items={data.items} />}
    </div>
  );
}

export function DeliveryTable({ items }: { items: Delivery[] }) {
  if (items.length === 0) return <p className="muted">No deliveries recorded.</p>;
  return (
    <table className="deliveries">
      <thead>
        <tr><th>Recipient</th><th>Channel</th><th>Mode</th><th>Lang</th><th>Status</th><th>Time</th></tr>
      </thead>
      <tbody>
        {items.map((d, i) => {
          const s = deliveryStatusLabel(d.status, d.channel_mode);
          return (
            <tr key={i}>
              <td>{d.recipient}{d.destination_masked ? <div className="small muted">{d.destination_masked}</div> : null}</td>
              <td>{d.channel}</td>
              <td>{d.channel_mode}</td>
              <td>{d.language}</td>
              <td><span className={`badge tone-${s.tone}`}>{s.text}</span></td>
              <td className="small">{fmtTime(d.acknowledged_at ?? d.sent_at ?? d.queued_at)}</td>
            </tr>
          );
        })}
        {items.some((d) => d.rendered_text) && (
          <tr><td colSpan={6} className="small muted">Rendered text below per delivery.</td></tr>
        )}
        {items.filter((d) => d.rendered_text).map((d, i) => (
          <tr key={`t${i}`}><td colSpan={6} className="rendered"><code>{d.channel}/{d.language}</code> {d.rendered_text}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
