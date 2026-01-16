/**
 * Declarative route definitions for the API.
 * These are used by the main index.ts router.
 */

export type RoutePattern = {
  readonly method: string;
  readonly segments: readonly string[];
  readonly paramIndices?: Record<string, number>;
};

/**
 * Route definitions - declarative patterns for API endpoints.
 * Parameters are denoted with `:paramName` in the segments array.
 */
export const routes = {
  /** POST /api/rooms - Create a new room */
  createRoom: {
    method: "POST",
    segments: ["api", "rooms"]
  },

  /** POST /api/rooms/:roomId/turns - Submit a turn to a room */
  submitTurn: {
    method: "POST",
    segments: ["api", "rooms", ":roomId", "turns"],
    paramIndices: { roomId: 2 }
  },

  /** GET /api/rooms/:roomId/stream - WebSocket stream for room events */
  streamRoom: {
    method: "GET",
    segments: ["api", "rooms", ":roomId", "stream"],
    paramIndices: { roomId: 2 }
  },

  /** POST /api/turns/:turnId/audio - Upload audio for a turn */
  uploadAudio: {
    method: "POST",
    segments: ["api", "turns", ":turnId", "audio"],
    paramIndices: { turnId: 2 }
  }
} as const satisfies Record<string, RoutePattern>;

/**
 * Match a request against a route pattern.
 * Returns extracted parameters if matched, null otherwise.
 */
export const matchRoute = (
  method: string,
  pathSegments: string[],
  route: RoutePattern
): Record<string, string> | null => {
  if (method !== route.method) return null;
  if (pathSegments.length !== route.segments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < route.segments.length; i++) {
    const expected = route.segments[i];
    const actual = pathSegments[i];
    if (expected?.startsWith(":")) {
      // Parameter slot - capture the value
      params[expected.slice(1)] = actual ?? "";
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
};
