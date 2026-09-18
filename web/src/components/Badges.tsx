import type { ConnectionStatus, Provenance } from "../api/types";
import { CONNECTION_LABELS, PROVENANCE_LABELS } from "../lib/labels";

export const DISCLAIMER = "Decision-support risk estimate. Not an official warning.";

export function ProvenanceBadge({ provenance }: { provenance: Provenance | string | null | undefined }) {
  if (!provenance || !(provenance in PROVENANCE_LABELS)) {
    return (
      <span className="badge prov prov-unknown" data-testid="provenance-badge" title="The API did not report provenance for this value">
        Provenance not reported
      </span>
    );
  }
  const p = provenance as Provenance;
  return (
    <span className={`badge prov prov-${p.toLowerCase()}`} data-testid="provenance-badge" title={p}>
      {PROVENANCE_LABELS[p]} <code>{p}</code>
    </span>
  );
}

export function ConnectionBadge({ status }: { status: ConnectionStatus | string }) {
  const label = CONNECTION_LABELS[status as ConnectionStatus] ?? `Unrecognised status: ${status}`;
  return (
    <span className={`badge conn conn-${status.toLowerCase()}`} data-testid="connection-badge" title={status}>
      {label} <code>{status}</code>
    </span>
  );
}

export function VirtualSensorBadge() {
  return <span className="badge virtual">Virtual sensor (simulated)</span>;
}

export function Disclaimer({ text }: { text?: string | null }) {
  return <p className="disclaimer" role="note">{text || DISCLAIMER}</p>;
}
