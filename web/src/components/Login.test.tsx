import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { createApiClient, DEFAULT_BASE_URL } from "../api/client";
import { LoginScreen } from "./LoginScreen";

// The map needs WebGL, which jsdom lacks; it is not under test here.
vi.mock("./MapView", () => ({ MapView: () => <div data-testid="map-stub" /> }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

const user = { id: "u900", full_name: "Test Authority", email: "authority.test@example.org", role: "DISTRICT_AUTHORITY", preferred_language: "en", admin_boundary_id: "d01", is_demo_account: true };

describe("login", () => {
  it("shows an invalid-credentials message on 401 (mock client)", async () => {
    const client = createApiClient({ mode: "mock", baseUrl: DEFAULT_BASE_URL, getToken: () => null, onUnauthenticated: vi.fn() });
    const onLogin = vi.fn();
    render(<LoginScreen client={client} onLogin={onLogin} />);
    fillAndSubmit("authority.mock@example.org", "wrong");
    expect(await screen.findByText("Invalid email or password.")).toBeTruthy();
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("shows the error envelope for non-401 failures", async () => {
    const fetchImpl = vi.fn(async () => json(503, { error: { code: "UPSTREAM_UNAVAILABLE", message: "Database unavailable", request_id: "req-9" } }));
    render(<App config={{ mode: "live", baseUrl: "http://api.test/api/v1", basemapStyleUrl: null }} fetchImpl={fetchImpl} />);
    fillAndSubmit("a@example.org", "x");
    expect(await screen.findByText(/Database unavailable/)).toBeTruthy();
    expect(screen.getByText(/request_id: req-9/)).toBeTruthy();
  });

  it("logs in (live), then returns to the login screen when an API call returns 401", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/auth/login")) return json(200, { access_token: "tok", token_type: "bearer", expires_in: 3600, user });
      if (url.endsWith("/system/mode")) return json(200, { run_mode: "LIVE" });
      return json(401, { error: { code: "UNAUTHENTICATED", message: "Token expired" } });
    });
    render(<App config={{ mode: "live", baseUrl: "http://api.test/api/v1", basemapStyleUrl: null }} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fillAndSubmit("authority.test@example.org", "pw");
    expect(await screen.findByText(/session has expired/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(window.sessionStorage.getItem("georakshak.session")).toBeNull();
    const authHeaders = fetchImpl.mock.calls
      .filter(([u]) => !String(u).endsWith("/auth/login"))
      .map(([, init]) => ((init as unknown as RequestInit).headers as Record<string, string>).Authorization);
    expect(authHeaders.every((h) => h === "Bearer tok")).toBe(true);
  });

  it("mock mode: logs in, shows MOCK DATA banner, role and run mode, and logs out", async () => {
    render(<App config={{ mode: "mock", baseUrl: DEFAULT_BASE_URL, basemapStyleUrl: null }} />);
    fillAndSubmit("authority.mock@example.org", "mock");
    expect(await screen.findByText("District authority")).toBeTruthy();
    expect(screen.getByText(/MOCK DATA — fictional fixtures/)).toBeTruthy();
    expect(await screen.findByText(/DEMO REPLAY MODE/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("open-system-status"));
    await waitFor(() => expect(screen.getByTestId("status-counts").textContent).toContain("awaiting access"));
    expect(screen.getAllByTestId("label-legend-item")).toHaveLength(7);
    fireEvent.click(screen.getByTestId("close-system-status"));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
