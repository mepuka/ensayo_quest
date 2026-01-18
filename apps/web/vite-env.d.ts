/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional override for WebSocket base URL.
   * Resolved via /api/rooms/:roomId/ws when possible; falls back to this value
   * or window.location.href when not set (local dev).
   *
   * Example: "https://ensayo-quest-api-staging.kokokessy.workers.dev"
   */
  readonly VITE_WS_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
