import type { User } from "../api/types";

const KEY = "georakshak.session";

export interface Session {
  token: string;
  user: User;
  expiresAt: number;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSession(now = Date.now()): Session | null {
  const raw = storage()?.getItem(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (!s.token || !s.user || s.expiresAt <= now) {
      clearSession();
      return null;
    }
    return s;
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(s: Session): void {
  storage()?.setItem(KEY, JSON.stringify(s));
}

export function clearSession(): void {
  storage()?.removeItem(KEY);
}
