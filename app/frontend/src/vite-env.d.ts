/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Development only: identity sent as X-Dev-User-Email. See api/client.ts. */
  readonly VITE_DEV_USER_EMAIL?: string;
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
