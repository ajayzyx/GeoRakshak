import { useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client";
import type { Report, ReportMediaRef, ReportsResponse, VerifyResponse } from "../api/types";
import { usePolling, type Polled } from "../lib/usePolling";
import { fmtTime } from "../lib/format";
import { humanize } from "../lib/labels";
import { severityColor, severityLabel } from "../lib/severity";
import { ProvenanceBadge } from "./Badges";
import { ErrorBox } from "./ErrorBox";
import { ResourceStatus } from "./ResourceStatus";
import { AuditTrail } from "./AuditTrail";

export function ReporterRoleBadge({ role }: { role: string }) {
  if (role === "CITIZEN") return <span className="badge role-citizen">Citizen · moderation required</span>;
  if (role === "FIELD_OFFICER") return <span className="badge role-field">Field officer</span>;
  return <span className="badge">{humanize(role)}</span>;
}

export function VerificationBadge({ status }: { status: string }) {
  return <span className={`badge verif verif-${status.toLowerCase()}`}>{status}</span>;
}

interface ListProps {
  resource: Polled<ReportsResponse | null>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ReportList({ resource, selectedId, onSelect }: ListProps) {
  const [filter, setFilter] = useState<string>("ALL");
  const reports = resource.data?.items ?? null;
  if (!reports) return <ResourceStatus resource={resource} label="reports" />;
  const shown = filter === "ALL" ? reports : reports.filter((r) => r.verification_status === filter);
  return (
    <div>
      <ResourceStatus resource={resource} label="reports" />
      <div className="filter-row">
        {["ALL", "UNVERIFIED", "VERIFIED", "REJECTED"].map((f) => (
          <button key={f} className={filter === f ? "seg active" : "seg"} onClick={() => setFilter(f)}>{humanize(f)}</button>
        ))}
      </div>
      {reports.length === 0 ? (
        <p className="muted" data-testid="empty-reports">No reports yet</p>
      ) : shown.length === 0 ? (
        <p className="muted">No reports with this status.</p>
      ) : (
        <ul className="item-list" data-testid="report-list">
          {shown.map((r) => (
            <li key={r.id} className={r.id === selectedId ? "selected" : ""}>
              <button className="item" onClick={() => onSelect(r.id)} data-testid="report-item" data-report-id={r.id}>
                <div className="item-head">
                  <strong>{humanize(r.category)}</strong>
                  <span className="severity-pill small" style={{ background: severityColor(r.severity) }}>{severityLabel(r.severity)}</span>
                  <VerificationBadge status={r.verification_status} />
                </div>
                <div className="item-sub">
                  <ReporterRoleBadge role={r.reporter_role} /> <span className="muted small">{fmtTime(r.submitted_at)}</span>
                  {r.media.length > 0 && <span className="small"> · {r.media.length} media</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function resolveMediaUrl(url: string, apiBaseUrl: string): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  try {
    return new URL(url, apiBaseUrl).toString();
  } catch {
    return url;
  }
}

export function MediaView({ media, url }: { media: { media_type: string; mime_type?: string }; url: string }) {
  if (media.media_type === "VIDEO") {
    return <video controls preload="metadata" src={url} className="media" data-testid="media-video" />;
  }
  return <img src={url} alt="Report photo" className="media" data-testid="media-photo" />;
}

function MediaItem({ client, media, apiBaseUrl }: { client: ApiClient; media: ReportMediaRef; apiBaseUrl: string }) {
  const uploaded = media.upload_status === "UPLOADED";
  const { data, error, refresh } = usePolling((signal) => (uploaded ? client.media(media.id, { signal }) : Promise.resolve(null)), null, [media.id, uploaded]);
  return (
    <div className="media-item">
      <div className="small">{media.media_type} · upload: {humanize(media.upload_status)}</div>
      {!uploaded ? (
        <div className="notice small">Uploading — media not yet received by the server.</div>
      ) : error ? (
        <ErrorBox error={error} context="Media" onRetry={refresh} />
      ) : data ? (
        <MediaView media={data} url={resolveMediaUrl(data.url, apiBaseUrl)} />
      ) : (
        <div className="muted small">Loading media…</div>
      )}
    </div>
  );
}

interface DetailProps {
  client: ApiClient;
  report: Report;
  apiBaseUrl: string;
  canVerify: boolean;
  onChanged: () => void;
  onShowCell?: (id: string) => void;
}

export function ReportDetail({ client, report, apiBaseUrl, canVerify, onChanged, onShowCell }: DetailProps) {
  const [decision, setDecision] = useState<"VERIFIED" | "REJECTED">("VERIFIED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<VerifyResponse | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await client.verifyReport(report.id, { decision, note: note.trim() }));
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const [lon, lat] = report.location.coordinates;
  return (
    <div className="report-detail" aria-label="Report detail" data-testid="report-detail" data-report-id={report.id}>
      <h2>{humanize(report.category)} report</h2>
      <div className="badge-row">
        <ReporterRoleBadge role={report.reporter_role} />
        <VerificationBadge status={report.verification_status} />
        <ProvenanceBadge provenance={report.provenance} />
      </div>
      <dl className="kv">
        <dt>Reporter</dt><dd>{report.reporter_name ?? "—"}</dd>
        <dt>Severity</dt><dd>{severityLabel(report.severity)} (reported)</dd>
        <dt>Description</dt><dd>{report.description ?? "—"}</dd>
        <dt>Location</dt>
        <dd>{lat.toFixed(5)}, {lon.toFixed(5)} · GPS ±{report.gps_accuracy_m ?? "?"} m{report.location_adjusted_manually ? " · manually adjusted" : ""}</dd>
        <dt>Captured</dt><dd>{fmtTime(report.captured_at)}</dd>
        <dt>Submitted</dt><dd>{fmtTime(report.submitted_at)}</dd>
        <dt>Media</dt><dd>{report.media.length} of {report.media_expected} expected</dd>
        {report.risk_zone_id && (<><dt>Risk zone</dt><dd>{onShowCell ? <button className="link" onClick={() => onShowCell(report.risk_zone_id!)}>show cell</button> : <code>{report.risk_zone_id}</code>}</dd></>)}
        {report.road_segment_id && (<><dt>Road segment</dt><dd><code>{report.road_segment_id}</code></dd></>)}
        {report.verification_status !== "UNVERIFIED" && (<><dt>Reviewed</dt><dd>{fmtTime(report.verified_at)}{report.verification_note ? ` — ${report.verification_note}` : ""}</dd></>)}
      </dl>
      <div className="media-grid">
        {report.media.map((m) => <MediaItem key={m.id} client={client} media={m} apiBaseUrl={apiBaseUrl} />)}
      </div>
      {canVerify && report.verification_status === "UNVERIFIED" && !result && (
        <form className="card form" onSubmit={submit}>
          <h3>Review report</h3>
          <div className="filter-row">
            <label className="inline"><input type="radio" checked={decision === "VERIFIED"} onChange={() => setDecision("VERIFIED")} /> Verify</label>
            <label className="inline"><input type="radio" checked={decision === "REJECTED"} onChange={() => setDecision("REJECTED")} /> Reject</label>
          </div>
          <label>
            Note
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What the evidence shows" />
          </label>
          <button className="primary" type="submit" disabled={busy}>{busy ? "Submitting…" : decision === "VERIFIED" ? "Mark VERIFIED" : "Mark REJECTED"}</button>
        </form>
      )}
      {error !== null && <ErrorBox error={error} context="Verification failed" />}
      <AuditTrail client={client} entityType="report" entityId={report.id} refreshKey={result ? "verified" : "initial"} />
      {result && (
        <div className="success">
          Report is now <strong>{result.verification_status}</strong>.
          {result.effects && (
            <ul>
              {result.effects.road_segment && <li>Road segment <code>{result.effects.road_segment.id}</code> → <strong>{result.effects.road_segment.status}</strong></li>}
              {result.effects.villages_access_at_risk !== undefined && <li>Villages with access at risk: {result.effects.villages_access_at_risk}</li>}
              {result.effects.priority_recomputed !== undefined && <li>Priority recomputed: {result.effects.priority_recomputed ? "yes" : "no"}</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
