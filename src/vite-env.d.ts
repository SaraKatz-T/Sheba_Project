/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" = answer /api requests with the in-browser mock server. */
  readonly VITE_USE_MOCK?: string
  /** Python server address; the Vite dev server proxies /api to it. */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
