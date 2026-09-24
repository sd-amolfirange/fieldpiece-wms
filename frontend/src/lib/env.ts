// Typed access to Vite env vars (Section 14). Read env through this module only.

export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api",
  oidcAuthority: import.meta.env.VITE_OIDC_AUTHORITY ?? "",
  oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID ?? "",
  sentryDsn: import.meta.env.VITE_SENTRY_DSN ?? "",
  enableMocks: import.meta.env.VITE_ENABLE_MOCKS === "true",
  /** Offers the seed accounts on the sign-in page (dev server and demo builds). */
  demoMode: import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true",
  /** Environment tag in the top bar; `.env.showcase` turns it off for the demo. */
  showEnvironmentTag: import.meta.env.VITE_SHOW_ENV_TAG !== "false",
  expiringSoonDays: Number(import.meta.env.VITE_EXPIRING_SOON_DAYS ?? 60) || 60,
  mode: import.meta.env.MODE,
} as const;
