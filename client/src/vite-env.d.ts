/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" = answer /api requests with the in-browser mock server. */
  readonly VITE_USE_MOCK?: string
  /** Python server address; the Vite dev server proxies /api to it. */
  readonly VITE_API_URL?: string
  /** Address phones should open for the capture page, e.g. https://forms.example.org. */
  readonly VITE_PUBLIC_URL?: string
  /** Filled in by vite.config when VITE_LAN=true: this computer on the local network. */
  readonly VITE_LAN_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
