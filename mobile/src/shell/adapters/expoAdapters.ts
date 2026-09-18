// Thin bindings from the core interfaces to Expo / React Native modules.
// Kept free of logic so the core stays unit-testable without a device.

import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { AppState } from 'react-native';
import { SecretStore } from '../../core/authService';
import { SqlDatabase, SqlValue, serialTransactions } from '../../core/db';
import { Connectivity } from '../../core/syncEngine';

export async function openExpoDatabase(name = 'georakshak.db'): Promise<SqlDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
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

export const secureSecrets: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

/** `isInternetReachable` is null while unknown; only an explicit false counts as offline. */
const onlineFrom = (s: { isConnected: boolean | null; isInternetReachable: boolean | null }) =>
  s.isConnected !== false && s.isInternetReachable !== false;

export const netInfoConnectivity: Connectivity = {
  isOnline: async () => onlineFrom(await NetInfo.fetch()),
};

export function subscribeConnectivity(cb: (online: boolean) => void): () => void {
  return NetInfo.addEventListener((s) => cb(onlineFrom(s)));
}

export function subscribeForeground(cb: () => void): () => void {
  let last = AppState.currentState;
  const sub = AppState.addEventListener('change', (next) => {
    if (last !== 'active' && next === 'active') cb();
    last = next;
  });
  return () => sub.remove();
}

export const newUuid = (): string => Crypto.randomUUID();
