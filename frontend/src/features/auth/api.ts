import { http } from "@/lib/http";
import type { AuthResponse, DemoAccount, LoginRequest } from "./types";

// [CONFIRM] identity provider (Azure AD B2C, Auth0, ...). Once chosen, replace `login` with an
// OIDC Authorization Code + PKCE redirect (e.g. oidc-client-ts) using VITE_OIDC_AUTHORITY / CLIENT_ID.
// The refresh flow stays the same: httpOnly cookie in, access token back into memory.

export const authApi = {
  login: (body: LoginRequest) =>
    http.post<AuthResponse>("/auth/login", body, { skipAuthRefresh: true }).then((r) => r.data),

  /** Restores the session from the httpOnly refresh cookie. */
  refresh: () =>
    http.post<AuthResponse>("/auth/refresh", undefined, { skipAuthRefresh: true }).then((r) => r.data),

  logout: () => http.post("/auth/logout", undefined, { skipAuthRefresh: true }).then(() => undefined),

  /** Demo server only: accounts for the "Sign in as" picker. */
  demoAccounts: () =>
    http.get<DemoAccount[]>("/auth/demo-accounts", { skipAuthRefresh: true }).then((r) => r.data),

  forgotPassword: (email: string) =>
    http.post("/auth/forgot-password", { email }, { skipAuthRefresh: true }).then(() => undefined),
};
