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
  /** "Forgot password" link and form; `.env.showcase` turns it off (the demo server has no password reset). */
  showForgotPassword: import.meta.env.VITE_SHOW_FORGOT_PASSWORD !== "false",
  expiringSoonDays: Number(import.meta.env.VITE_EXPIRING_SOON_DAYS ?? 30) || 30,
  /**
   * Warranty Assistant chat button (../chatbot), loaded from `assistantUrl` (same origin: nginx or the Vite proxy).
   * Off unless VITE_ASSISTANT_ENABLED=true, so unit and UI tests never depend on the chatbot service.
   */
  assistantEnabled: import.meta.env.VITE_ASSISTANT_ENABLED === "true",
  assistantUrl: import.meta.env.VITE_ASSISTANT_URL || "/assistant",
  /** Internal Fieldpiece apps linked from the warranty desk's sidebar. [CONFIRM real URLs] */
  overwatchUrl: import.meta.env.VITE_OVERWATCH_URL || "https://overwatch.example.com",
  jobLinkUrl: import.meta.env.VITE_JOBLINK_URL || "https://joblink.example.com",
  mode: import.meta.env.MODE,
} as const;
