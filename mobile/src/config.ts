// Build-time configuration. Expo inlines EXPO_PUBLIC_* variables when bundling.

export type ApiMode = 'live' | 'mock';

const rawMode = process.env.EXPO_PUBLIC_API_MODE;

export const API_MODE: ApiMode = rawMode === 'live' ? 'live' : 'mock';

/**
 * Default matches docs/development.md §3. On a physical phone `localhost` is
 * the phone itself: set this to the laptop's LAN IP (see README).
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

export const APP_VERSION = '0.1.0';

/** Inbox polling interval while the app is open (push is not connected, H8). */
export const INBOX_POLL_MS = 15_000;
/** Periodic queue sync while the app is open. */
export const SYNC_INTERVAL_MS = 30_000;
