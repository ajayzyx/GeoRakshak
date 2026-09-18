// Web overrides for the Expo adapters, picked up by Metro for `--platform web`.
// The browser build is the PRESENTATION PATH ONLY (see README): it lets a judge
// see the app without a device. It is not a deployment target.
//
// Differences from native, all deliberate:
//  - expo-secure-store has no web implementation, so the token goes to
//    localStorage. That is NOT secure storage; the web build is mock mode only.
//  - connectivity comes from navigator.onLine, so the browser's offline mode
//    drives the app's offline path.
//  - foreground is the page becoming visible again.
// expo-sqlite works on web through its wa-sqlite WebAssembly build (see metro.config.js).

import * as SQLite from 'expo-sqlite';
import { SecretStore } from '../../core/authService';
import { SqlDatabase, SqlValue, serialTransactions } from '../../core/db';
import { Connectivity } from '../../core/syncEngine';

export async function openExpoDatabase(name = 'georakshak.db'): Promise<SqlDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      const r = await db.runAsync(sql, params);
      return { changes: r.changes };
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    transaction: serialTransactions((fn) => db.withTransactionAsync(fn)),
  };
}

const memory = new Map<string, string>();

function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Storage can be blocked (private mode, third-party context).
  }
  return {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  };
}

export const secureSecrets: SecretStore = {
  get: async (key) => storage().getItem(key),
  set: async (key, value) => storage().setItem(key, value),
  remove: async (key) => storage().removeItem(key),
};

const browserOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

export const netInfoConnectivity: Connectivity = { isOnline: async () => browserOnline() };

export function subscribeConnectivity(cb: (online: boolean) => void): () => void {
  const emit = () => cb(browserOnline());
  window.addEventListener('online', emit);
  window.addEventListener('offline', emit);
  emit(); // same contract as NetInfo: report the current state on subscribe
  return () => {
    window.removeEventListener('online', emit);
    window.removeEventListener('offline', emit);
  };
}

export function subscribeForeground(cb: () => void): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') cb();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}

export const newUuid = (): string => crypto.randomUUID();
