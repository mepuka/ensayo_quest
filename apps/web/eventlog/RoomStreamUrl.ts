import { Effect } from "effect";
import { decodeRoomWsResponse } from "@ensayo/shared";

const roomWsUrlCache = new Map<string, string>();
const storagePrefix = "ensayo:room-ws-url:";

const canUseSessionStorage = () =>
  typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

const readSessionStorage = (roomId: string): string | null => {
  if (!canUseSessionStorage()) return null;
  try {
    return window.sessionStorage.getItem(`${storagePrefix}${roomId}`);
  } catch {
    return null;
  }
};

const writeSessionStorage = (roomId: string, wsUrl: string): void => {
  if (!canUseSessionStorage()) return;
  try {
    window.sessionStorage.setItem(`${storagePrefix}${roomId}`, wsUrl);
  } catch {
    // Ignore storage failures (quota, private mode)
  }
};

export const cacheRoomStreamUrl = (roomId: string, wsUrl: string): void => {
  roomWsUrlCache.set(roomId, wsUrl);
  writeSessionStorage(roomId, wsUrl);
};

const getCachedRoomStreamUrl = (roomId: string): string | null => {
  const cached = roomWsUrlCache.get(roomId);
  if (cached) return cached;
  const stored = readSessionStorage(roomId);
  if (stored) {
    roomWsUrlCache.set(roomId, stored);
    return stored;
  }
  return null;
};

export const buildRoomStreamUrl = (baseUrl: string, roomId: string) => {
  const url = new URL(baseUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/api/rooms/${roomId}/stream`;
};

const getFallbackBaseUrl = (): string => {
  const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (wsBaseUrl && wsBaseUrl.trim() !== "") return wsBaseUrl;
  if (typeof window !== "undefined" && window.location?.href) return window.location.href;
  return "http://localhost";
};

const fetchRoomStreamUrl = (roomId: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`/api/rooms/${roomId}/ws`, {
        headers: { Accept: "application/json" }
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      const decoded = decodeRoomWsResponse(json);
      return decoded.wsUrl;
    },
    catch: (cause) => new Error(`Failed to resolve wsUrl: ${String(cause)}`)
  });

/**
 * Resolve a room WebSocket URL.
 * Order: memory/session cache → API resolve → env/location fallback.
 */
export const resolveRoomStreamUrl = (roomId: string) =>
  Effect.gen(function* () {
    const cached = getCachedRoomStreamUrl(roomId);
    if (cached) return cached;

    return yield* fetchRoomStreamUrl(roomId).pipe(
      Effect.tap((wsUrl) => Effect.sync(() => cacheRoomStreamUrl(roomId, wsUrl))),
      Effect.orElse(() =>
        Effect.sync(() => {
          const fallback = buildRoomStreamUrl(getFallbackBaseUrl(), roomId);
          cacheRoomStreamUrl(roomId, fallback);
          return fallback;
        })
      )
    );
  });
