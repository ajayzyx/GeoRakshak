import { useCallback, useMemo, useRef, useState } from "react";
import { createApiClient, type ApiMode } from "./api/client";
import type { LoginResponse } from "./api/types";
import { clearSession, loadSession, saveSession, type Session } from "./lib/session";
import { LoginScreen } from "./components/LoginScreen";
import { Dashboard } from "./components/Dashboard";

export interface AppConfig {
  mode: ApiMode;
  baseUrl: string;
  basemapStyleUrl: string | null;
}

export function App({ config, fetchImpl }: { config: AppConfig; fetchImpl?: typeof fetch }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [notice, setNotice] = useState<string | null>(null);
  const [backendReachable, setBackendReachable] = useState(true);
  // Token lives in memory (ref) and is mirrored to sessionStorage so a reload keeps the session.
  const tokenRef = useRef<string | null>(session?.token ?? null);

  const endSession = useCallback((message: string | null) => {
    tokenRef.current = null;
    clearSession();
    setSession(null);
    setNotice(message);
  }, []);

  const client = useMemo(
    () =>
      createApiClient({
        mode: config.mode,
        baseUrl: config.baseUrl,
        fetchImpl,
        getToken: () => tokenRef.current,
        onUnauthenticated: () => endSession("Your session has expired or is no longer valid. Please log in again."),
        onConnectivityChange: setBackendReachable,
      }),
    [config.mode, config.baseUrl, fetchImpl, endSession],
  );

  const onLogin = useCallback((res: LoginResponse) => {
    const s: Session = { token: res.access_token, user: res.user, expiresAt: Date.now() + res.expires_in * 1000 };
    tokenRef.current = s.token;
    saveSession(s);
    setNotice(null);
    setSession(s);
  }, []);

  if (!session) return <LoginScreen client={client} onLogin={onLogin} notice={notice} />;
  return (
    <Dashboard
      client={client}
      user={session.user}
      apiBaseUrl={config.baseUrl}
      basemapStyleUrl={config.basemapStyleUrl}
      backendReachable={backendReachable}
      onLogout={() => endSession(null)}
    />
  );
}
