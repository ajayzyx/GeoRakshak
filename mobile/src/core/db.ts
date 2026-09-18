// Minimal SQL adapter. The app binds it to expo-sqlite; tests bind it to
// Node's built-in `node:sqlite`, so the same SQL runs in both.

export type SqlValue = string | number | null;

export interface SqlDatabase {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs `fn` atomically. Nested calls are not supported. */
  transaction(fn: () => Promise<void>): Promise<void>;
}

/**
 * Wraps a transaction runner so transactions start one after another. SQLite
 * rejects a BEGIN while another transaction is open, and the UI (save, discard)
 * and the sync engine can both start one at the same time.
 */
export function serialTransactions(
  runTransaction: (fn: () => Promise<void>) => Promise<void>,
): (fn: () => Promise<void>) => Promise<void> {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const next = tail.then(() => runTransaction(fn));
    tail = next.catch(() => undefined);
    return next;
  };
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS reports (
    client_report_id TEXT PRIMARY KEY NOT NULL,
    owner_user_id TEXT NOT NULL,
    alert_id TEXT,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    description TEXT NOT NULL,
    language TEXT NOT NULL,
    lon REAL NOT NULL,
    lat REAL NOT NULL,
    gps_accuracy_m REAL,
    location_adjusted_manually INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    server_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    synced_at TEXT
  );
  CREATE TABLE IF NOT EXISTS media (
    client_media_id TEXT PRIMARY KEY NOT NULL,
    client_report_id TEXT NOT NULL REFERENCES reports(client_report_id),
    media_type TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_s REAL,
    captured_at TEXT NOT NULL,
    lat REAL,
    lon REAL,
    upload_status TEXT NOT NULL,
    server_id TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT
  );
  CREATE INDEX IF NOT EXISTS reports_owner_idx ON reports(owner_user_id, status);
  CREATE INDEX IF NOT EXISTS media_report_idx ON media(client_report_id);
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pending_acks (
    alert_id TEXT PRIMARY KEY NOT NULL,
    acknowledged_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  `,
];

/** Applies pending migrations, tracked with `PRAGMA user_version`. Safe to call on every start. */
export async function migrate(db: SqlDatabase): Promise<void> {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version');
  const current = rows[0]?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v] as string;
    await db.exec(sql);
    await db.exec(`PRAGMA user_version = ${v + 1}`);
  }
}
