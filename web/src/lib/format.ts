export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "not reported";
  return iso.slice(0, 10);
}

export function fmtValue(value: number | string | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return unit ? `${value} ${unit}` : String(value);
}

/** Local HH:MM, used for "stale since" labels. */
export function fmtClock(d: Date | null | undefined): string {
  if (!d) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
