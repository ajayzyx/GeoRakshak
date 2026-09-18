import { useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client";
import { isUnauthenticated } from "../api/errors";
import type { LoginResponse } from "../api/types";
import { ErrorBox } from "./ErrorBox";
import { DISCLAIMER } from "./Badges";

interface Props {
  client: ApiClient;
  onLogin: (res: LoginResponse) => void;
  notice?: string | null;
}

export function LoginScreen({ client, onLogin, notice }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLogin(await client.login(email, password));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit} aria-label="Log in">
        <h1>GeoRakshak</h1>
        <p className="muted">Landslide risk monitoring — decision support for disaster-management authorities.</p>
        {client.mode === "mock" && (
          <div className="mock-hint">
            <strong>MOCK DATA mode.</strong> Fictional accounts: <code>authority.mock@example.org</code>, <code>admin.mock@example.org</code>,{" "}
            <code>field.mock@example.org</code>, password <code>mock</code>.
          </div>
        )}
        {notice && <div className="notice" role="status">{notice}</div>}
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error !== null && isUnauthenticated(error) ? (
          <div className="error-box" role="alert">Invalid email or password.</div>
        ) : error !== null ? (
          <ErrorBox error={error} context="Login failed" />
        ) : null}
        <button type="submit" className="primary" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <p className="disclaimer small">{DISCLAIMER}</p>
      </form>
    </div>
  );
}
