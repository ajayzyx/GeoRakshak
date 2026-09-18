import { useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client";
import type {
  Feature,
  HistoricalLandslideProps,
  LocationProps,
  Provenance,
  RoadSegmentFeature,
  RoadStatus,
  SensorStationProps,
} from "../api/types";
import { ROAD_STATUSES } from "../api/types";
import { fmtTime, fmtValue } from "../lib/format";
import { ROAD_LEGEND_NOTE, ROAD_STATUS_COLORS, ROAD_STATUS_LABELS, humanize, roadStatusSourceLabel } from "../lib/labels";
import { ProvenanceBadge, VirtualSensorBadge } from "./Badges";
import { ErrorBox } from "./ErrorBox";

export function StationDetail({ station }: { station: Feature<SensorStationProps> }) {
  const p = station.properties;
  return (
    <div>
      <h2>Sensor station <code>{p.station_code}</code></h2>
      <div className="badge-row">
        {p.station_type === "VIRTUAL" ? <VirtualSensorBadge /> : <span className="badge">Physical station</span>}
        <ProvenanceBadge provenance={p.provenance} />
      </div>
      <dl className="kv">
        <dt>Name</dt><dd>{p.name}</dd>
        <dt>Status</dt><dd>{p.status}</dd>
        <dt>Latest reading</dt>
        <dd>{p.latest_reading ? `${humanize(p.latest_reading.variable)}: ${fmtValue(p.latest_reading.value, p.latest_reading.unit)} at ${fmtTime(p.latest_reading.observed_at)}` : "No readings"}</dd>
      </dl>
    </div>
  );
}

export function LocationDetail({ location, fallbackProvenance }: { location: Feature<LocationProps>; fallbackProvenance?: Provenance }) {
  const p = location.properties;
  return (
    <div>
      <h2>{p.name}</h2>
      <ProvenanceBadge provenance={p.provenance ?? fallbackProvenance} />
      <dl className="kv">
        <dt>Type</dt><dd>{humanize(p.type)}</dd>
        <dt>Access status</dt><dd>{humanize(p.access_status)}</dd>
        <dt>Population</dt><dd>{p.population ?? "not recorded"}{p.population_source_year ? ` (source year ${p.population_source_year})` : ""}</dd>
        <dt>Source</dt><dd><code>{p.source_slug}</code></dd>
      </dl>
    </div>
  );
}

export function LandslideDetail({ event, fallbackProvenance }: { event: Feature<HistoricalLandslideProps>; fallbackProvenance?: Provenance }) {
  const p = event.properties;
  return (
    <div>
      <h2>Historical landslide record</h2>
      <ProvenanceBadge provenance={p.provenance ?? fallbackProvenance} />
      <dl className="kv">
        <dt>Event date</dt><dd>{p.event_date ?? "not recorded"}{p.event_date_precision ? ` (precision: ${p.event_date_precision})` : ""}</dd>
        <dt>Trigger</dt><dd>{p.trigger ?? "—"}</dd>
        <dt>Type</dt><dd>{p.landslide_type ?? "—"}</dd>
        <dt>Location accuracy</dt><dd>{p.location_accuracy_m != null ? `${p.location_accuracy_m} m` : "not recorded"}</dd>
        <dt>Source</dt><dd><code>{p.source_slug}</code></dd>
      </dl>
    </div>
  );
}

interface RoadProps {
  client: ApiClient;
  road: RoadSegmentFeature;
  canOverride: boolean;
  fallbackProvenance?: Provenance;
  onChanged: () => void;
  onOpenReport?: (id: string) => void;
}

export function RoadDetail({ client, road, canOverride, fallbackProvenance, onChanged, onOpenReport }: RoadProps) {
  const p = road.properties;
  const [status, setStatus] = useState<RoadStatus>(p.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<RoadSegmentFeature | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await client.overrideRoadStatus(road.id as string, { status, reason: reason.trim() }));
      setReason("");
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="road-detail" data-road-id={road.id}>
      <h2>Road segment{p.name ? `: ${p.name}` : ""}</h2>
      <div className="badge-row">
        <span className="severity-pill" style={{ background: ROAD_STATUS_COLORS[p.status] ?? "#757575" }} data-testid="road-status">
          {ROAD_STATUS_LABELS[p.status] ?? p.status}
        </span>
        <ProvenanceBadge provenance={p.provenance ?? fallbackProvenance} />
      </div>
      <p className="small muted">{ROAD_LEGEND_NOTE}</p>
      <dl className="kv">
        <dt>Status</dt><dd><code>{p.status}</code></dd>
        <dt>Status source</dt><dd data-testid="road-status-source">{roadStatusSourceLabel(p.status_source)}</dd>
        <dt>Reason</dt><dd>{p.status_reason ?? "—"}</dd>
        <dt>Updated</dt><dd>{fmtTime(p.status_updated_at)}</dd>
        <dt>Villages with access at risk</dt>
        <dd>{p.villages_access_at_risk === undefined || p.villages_access_at_risk === null ? <span className="muted">not reported by the API</span> : p.villages_access_at_risk}</dd>
        <dt>Linked report</dt>
        <dd>
          {p.status_report_id ? (
            onOpenReport ? (
              <button className="link" onClick={() => onOpenReport(p.status_report_id!)} data-testid="road-linked-report">open report</button>
            ) : (
              <code>{p.status_report_id}</code>
            )
          ) : (
            <span className="muted">none</span>
          )}
        </dd>
        <dt>Road class</dt><dd>{p.road_class}</dd>
      </dl>
      {canOverride && (
        <form className="card form" onSubmit={submit}>
          <h3>Authority status override</h3>
          <label>
            New status
            <select value={status} onChange={(e) => setStatus(e.target.value as RoadStatus)}>
              {ROAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Reason (recorded in the audit log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="e.g. Cleared, confirmed by field team" />
          </label>
          <button className="primary" type="submit" disabled={busy || !reason.trim()}>{busy ? "Saving…" : "Override status"}</button>
          {error !== null && <ErrorBox error={error} context="Override failed" />}
          {done && <div className="success">Status is now <strong>{done.properties.status}</strong> (source: {humanize(done.properties.status_source)}).</div>}
        </form>
      )}
    </div>
  );
}
