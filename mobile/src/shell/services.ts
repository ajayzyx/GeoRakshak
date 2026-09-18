import { createContext, useContext } from 'react';
import { Platform } from 'react-native';
import { API_BASE_URL, API_MODE, APP_VERSION, ApiMode } from '../config';
import { ApiClient } from '../core/api';
import { AuthService } from '../core/authService';
import { migrate } from '../core/db';
import { FetchHttpClient } from '../core/fetchHttpClient';
import { HttpClient } from '../core/http';
import { SqliteAckQueue, SqliteKeyValueStore } from '../core/localCache';
import { SqliteReportStore } from '../core/reportStore';
import { SyncEngine } from '../core/syncEngine';
import { Clock, systemClock } from '../core/types';
import { MockHttpClient } from '../mock/mockHttpClient';
import { netInfoConnectivity, openExpoDatabase, secureSecrets } from './adapters/expoAdapters';
import { localFileExists } from './adapters/deviceCapture';

export interface AppServices {
  mode: ApiMode;
  baseUrl: string;
  clock: Clock;
  store: SqliteReportStore;
  kv: SqliteKeyValueStore;
  acks: SqliteAckQueue;
  api: ApiClient;
  auth: AuthService;
  engine: SyncEngine;
  device: { app_version: string; platform: string };
}

export async function createAppServices(onAuthRequired: () => void): Promise<AppServices> {
  const db = await openExpoDatabase();
  await migrate(db);
  const store = new SqliteReportStore(db);
  // Anything interrupted by an app kill goes back to the queue before the first sync.
  await store.recoverInterrupted();
  const kv = new SqliteKeyValueStore(db);
  const acks = new SqliteAckQueue(db);
  const clock = systemClock;

  const http: HttpClient =
    API_MODE === 'mock' ? new MockHttpClient(clock) : new FetchHttpClient({ baseUrl: API_BASE_URL });
  let auth!: AuthService;
  const api = new ApiClient(http, () => auth.getToken());
  auth = new AuthService({ api, secrets: secureSecrets, cache: kv, clock });
  const device = { app_version: APP_VERSION, platform: Platform.OS };
  const engine = new SyncEngine({
    store,
    api,
    clock,
    connectivity: netInfoConnectivity,
    device,
    currentUserId: () => auth.currentUser?.id ?? null,
    fileExists: localFileExists,
    onAuthRequired,
  });
  return { mode: API_MODE, baseUrl: API_BASE_URL, clock, store, kv, acks, api, auth, engine, device };
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesContext missing');
  return s;
}
