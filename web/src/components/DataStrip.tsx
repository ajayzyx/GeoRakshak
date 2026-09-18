import type { StripEntry } from "../lib/dataStrip";

/** Compact, always-visible statement of what is real, simulated, sandboxed or not connected in this view. */
export function DataStrip({ entries }: { entries: StripEntry[] }) {
  const notes = entries.filter((e) => e.note);
  return (
    <section className="data-strip" aria-label="Data in this view" data-testid="data-strip">
      <span className="data-strip-title">Data in this view</span>
      {entries.map((e) => (
        <span key={e.key} className={`strip-entry tone-${e.tone}`} data-testid={`strip-${e.key}`} title={e.note ?? e.text}>
          <strong>{e.label}</strong> <span className="strip-tag">{e.tag}</span> <span className="strip-text">{e.text}</span>
        </span>
      ))}
      {notes.length > 0 && (
        <div className="strip-notes">
          {notes.map((e) => (
            <div key={e.key} className="strip-note" data-testid={`strip-note-${e.key}`} title={e.note}>
              <strong>{e.label}:</strong> {e.note}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
