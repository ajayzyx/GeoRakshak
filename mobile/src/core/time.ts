const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/**
 * ISO 8601 with the device's local UTC offset, e.g. `2026-07-14T12:11:00+05:30`
 * (the api.md §5.6 `captured_at` example). Keeps the device's view of local
 * time while remaining unambiguous.
 */
export function toIsoWithOffset(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offsetMin / 60))}:${pad(offsetMin % 60)}`
  );
}

/** Human-friendly relative age for "last updated" labels. */
export function formatAge(iso: string | null, now: Date): string {
  if (!iso) return 'never';
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return 'unknown';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
