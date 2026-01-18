/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * WebSocket base URL for connecting to Workers API.
   * Required in Pages deployment (Pages Functions cannot proxy WebSocket).
   * Falls back to window.location.href when not set (local dev).
   *
   * Example: "https://ensayo-quest-api-staging.kokokessy.workers.dev"
   */
  readonly VITE_WS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
