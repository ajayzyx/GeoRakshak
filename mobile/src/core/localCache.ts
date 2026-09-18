import { SqlDatabase } from './db';

/** Small JSON cache (last inbox, last risk, last known user). Not for secrets. */
export interface KeyValueStore {
  get<T>(key: string): Promise<{ value: T; updated_at: string } | null>;
  set(key: string, value: unknown, updatedAt: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class SqliteKeyValueStore implements KeyValueStore {
  constructor(private readonly db: SqlDatabase) {}

  async get<T>(key: string): Promise<{ value: T; updated_at: string } | null> {
    const rows = await this.db.all<{ value: string; updated_at: string }>(
      'SELECT value, updated_at FROM kv WHERE key = ?',
      [key],
    );
    const row = rows[0];
    if (!row) return null;
    try {
      return { value: JSON.parse(row.value) as T, updated_at: row.updated_at };
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown, updatedAt: string): Promise<void> {
    await this.db.run(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), updatedAt],
    );
  }

  async remove(key: string): Promise<void> {
    await this.db.run('DELETE FROM kv WHERE key = ?', [key]);
  }
}

export interface PendingAck {
  alert_id: string;
  acknowledged_at: string;
  attempts: number;
  last_error: string | null;
}

/** Acknowledgements made while offline, sent when the network returns. */
export interface AckQueue {
  add(alertId: string, acknowledgedAt: string): Promise<void>;
  list(): Promise<PendingAck[]>;
  remove(alertId: string): Promise<void>;
  markAttempt(alertId: string, error: string): Promise<void>;
}

export class SqliteAckQueue implements AckQueue {
  constructor(private readonly db: SqlDatabase) {}

  async add(alertId: string, acknowledgedAt: string): Promise<void> {
    await this.db.run(
      'INSERT OR IGNORE INTO pending_acks (alert_id, acknowledged_at, attempts) VALUES (?, ?, 0)',
      [alertId, acknowledgedAt],
    );
  }

  async list(): Promise<PendingAck[]> {
    return this.db.all<PendingAck>('SELECT * FROM pending_acks ORDER BY acknowledged_at ASC');
  }

  async remove(alertId: string): Promise<void> {
    await this.db.run('DELETE FROM pending_acks WHERE alert_id = ?', [alertId]);
  }

  async markAttempt(alertId: string, error: string): Promise<void> {
    await this.db.run(
      'UPDATE pending_acks SET attempts = attempts + 1, last_error = ? WHERE alert_id = ?',
      [error, alertId],
    );
  }
}
