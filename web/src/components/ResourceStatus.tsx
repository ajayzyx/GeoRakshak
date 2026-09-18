import type { Polled } from "../lib/usePolling";
import { fmtClock } from "../lib/format";
import { ErrorBox } from "./ErrorBox";

export function Spinner({ label }: { label: string }) {
  return (
    <div className="loading" role="status" data-testid="loading">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

/** Stale label for data that is still shown after a failed refresh. */
export function StaleBadge({ resource }: { resource: Pick<Polled<unknown>, "stale" | "updatedAt" | "refresh"> }) {
  if (!resource.stale) return null;
  return (
    <span className="stale" data-testid="stale">
      stale since {fmtClock(resource.updatedAt)}{" "}
      <button type="button" className="link" onClick={resource.refresh}>retry</button>
    </span>
  );
}

/**
 * First-load spinner, error with Retry (when there is nothing to show), or a stale label (when old data is still shown).
 * Renders nothing once fresh data is present.
 */
export function ResourceStatus({ resource, label }: { resource: Polled<unknown>; label: string }) {
  if (resource.data === null && resource.loading) return <Spinner label={`Loading ${label}…`} />;
  if (resource.data === null && resource.error) return <ErrorBox error={resource.error} context={label} onRetry={resource.refresh} />;
  return <StaleBadge resource={resource} />;
}
