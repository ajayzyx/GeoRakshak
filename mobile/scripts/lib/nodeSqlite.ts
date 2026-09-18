// Node binding for the core SqlDatabase adapter (Node >= 22.13, built-in `node:sqlite`).
// Used by the jest suites and by `npm run check:live`; never bundled into the app.

import { DatabaseSync } from 'node:sqlite';
import { SqlDatabase, SqlValue, serialTransactions } from '../../src/core/db';

export function openNodeSqlite(path = ':memory:'): { db: SqlDatabase; close: () => void } {
  const raw = new DatabaseSync(path);
  const db: SqlDatabase = {
    async exec(sql) {
      raw.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    transaction: serialTransactions(async (fn) => {
      raw.exec('BEGIN');
      try {
        await fn();
        raw.exec('COMMIT');
      } catch (e) {
        if (raw.isTransaction) raw.exec('ROLLBACK');
        throw e;
      }
    }),
  };
  return { db, close: () => raw.close() };
}
