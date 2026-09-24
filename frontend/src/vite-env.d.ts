/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_ENABLE_MOCKS?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_SHOW_ENV_TAG?: string;
  readonly VITE_EXPIRING_SOON_DAYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
