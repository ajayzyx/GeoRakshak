import type { ApiClient } from "../api/client";
import type { AuditEvent } from "../api/types";
import { fmtTime } from "../lib/format";
import { humanize } from "../lib/labels";
import { usePolling } from "../lib/usePolling";
import { ResourceStatus } from "./ResourceStatus";

/** "Approved by X" / "Auto-dispatched by the system" — who did what, from GET /audit-events. */
export function AuditLine({ event }: { event: AuditEvent }) {
  const actor = event.actor ? `${event.actor.full_name} (${humanize(event.actor.role)})` : "the system (automatic)";
  return (
    <li className="small" data-testid="audit-event" data-action={event.action} data-actor={event.actor ? "user" : "system"}>
      <strong>{humanize(event.action)}</strong> by {actor} · {fmtTime(event.at)}
    </li>
  );
}

export function AuditTrail({ client, entityType, entityId, refreshKey }: { client: ApiClient; entityType: string; entityId: string; refreshKey?: unknown }) {
  const trail = usePolling((signal) => client.auditEvents(entityType, entityId, { signal }), null, [entityType, entityId], refreshKey ?? 0);
  return (
    <div data-testid="audit-trail">
      <h3>Recorded actions</h3>
      <ResourceStatus resource={trail} label="audit trail" />
      {trail.data &&
        (trail.data.items.length === 0 ? (
          <p className="muted small" data-testid="empty-audit">No recorded actions yet</p>
        ) : (
          <>
            <ul className="plain">
              {trail.data.items.map((e) => (
                <AuditLine key={String(e.id)} event={e} />
              ))}
            </ul>
            {trail.data.note && <p className="small muted">{trail.data.note}</p>}
          </>
        ))}
    </div>
  );
}
