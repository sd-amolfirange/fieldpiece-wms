/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_OIDC_AUTHORITY?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_ENABLE_MOCKS?: string;
  readonly VITE_DEMO_MODE?: string;
  readonly VITE_SHOW_ENV_TAG?: string;
  readonly VITE_SHOW_FORGOT_PASSWORD?: string;
  readonly VITE_EXPIRING_SOON_DAYS?: string;
  readonly VITE_ASSISTANT_ENABLED?: string;
  readonly VITE_ASSISTANT_URL?: string;
  readonly VITE_OVERWATCH_URL?: string;
  readonly VITE_JOBLINK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
