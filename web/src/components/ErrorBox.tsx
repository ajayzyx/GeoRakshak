import { ApiError } from "../api/errors";

export function ErrorBox({ error, context, onRetry }: { error: unknown; context?: string; onRetry?: () => void }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : new ApiError(0, "CLIENT_ERROR", error instanceof Error ? error.message : String(error));
  return (
    <div className="error-box" role="alert" data-testid="error-box">
      <strong>{context ? `${context}: ` : ""}{e.code}</strong>
      {e.status ? ` (HTTP ${e.status})` : ""} — {e.message}
      {e.details.length > 0 && (
        <ul>
          {e.details.map((d, i) => (
            <li key={i}>{d.field ? <code>{d.field}</code> : null} {d.issue}</li>
          ))}
        </ul>
      )}
      {e.requestId && <div className="muted small">request_id: {e.requestId}</div>}
      {onRetry && (
        <div>
          <button type="button" className="retry" onClick={onRetry} data-testid="retry">Retry</button>
        </div>
      )}
    </div>
  );
}
