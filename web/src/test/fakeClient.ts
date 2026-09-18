import { createApiClient, DEFAULT_BASE_URL, type ApiClient } from "../api/client";

/**
 * A logged-in mock client for component tests, with any method replaceable.
 * It never touches the network (the mock client is in-memory).
 */
export async function loggedInMockClient(overrides: Partial<ApiClient> = {}, email = "admin.mock@example.org"): Promise<ApiClient> {
  let token: string | null = null;
  const base = createApiClient({
    mode: "mock",
    baseUrl: DEFAULT_BASE_URL,
    getToken: () => token,
    onUnauthenticated: () => {},
  });
  const res = await base.login(email, "mock");
  token = res.access_token;
  return Object.assign(Object.create(Object.getPrototypeOf(base) as object), base, overrides) as ApiClient;
}

export const mockUser = (role: "ADMIN" | "DISTRICT_AUTHORITY" | "FIELD_OFFICER" = "DISTRICT_AUTHORITY") => ({
  id: "u-test",
  full_name: "Test User",
  email: "test@example.org",
  role,
  preferred_language: "en",
  admin_boundary_id: "b-test",
  is_demo_account: true,
});
