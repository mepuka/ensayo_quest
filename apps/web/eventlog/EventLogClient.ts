import { Effect, Layer, Stream, SubscriptionRef, Scope } from "effect";
import * as Redacted from "effect/Redacted";
import * as EventLog from "@effect/experimental/EventLog";
import * as EventLogEncryption from "@effect/experimental/EventLogEncryption";
import * as EventLogRemote from "@effect/experimental/EventLogRemote";
import * as EventJournal from "@effect/experimental/EventJournal";
import * as Socket from "@effect/platform/Socket";
import { decodeJournalEntry, type RoomEvent } from "../../shared/src/RoomProtocol";

// =============================================================================
// Connection Status Types
// =============================================================================

/**
 * WebSocket connection status for UI display.
 * - connecting: Initial connection attempt
 * - connected: WebSocket is open and syncing
 * - reconnecting: Connection lost, attempting to reconnect
 * - disconnected: Connection failed, not currently retrying
 */
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

/**
 * Connection state with additional context.
 */
export type ConnectionState = {
  readonly status: ConnectionStatus;
  readonly lastConnectedAt: number | null;
  readonly reconnectAttempts: number;
  readonly lastError: string | null;
};

export const makeRoomIdentity = Effect.fn(function* (roomId: string) {
  const encryption = yield* EventLogEncryption.EventLogEncryption;
  const key = yield* encryption.sha256(new TextEncoder().encode(roomId));
  return EventLog.Identity.of({
    publicKey: roomId,
    privateKey: Redacted.make(key)
  });
});

export const buildRoomStreamUrl = (baseUrl: string, roomId: string) => {
  const url = new URL(baseUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}/api/rooms/${roomId}/stream`;
};

/**
 * Get WebSocket URL for a room.
 *
 * Uses VITE_WS_BASE_URL env var when set (required for Pages deployment
 * because Pages Functions cannot proxy WebSocket connections).
 * Falls back to window.location.href for local development.
 */
export const getRoomStreamUrl = (roomId: string) => {
  // In production/staging, VITE_WS_BASE_URL points to Workers API directly
  const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  const baseUrl = wsBaseUrl || window.location.href;
  return buildRoomStreamUrl(baseUrl, roomId);
};

/**
 * Decode a journal entry into a RoomEvent.
 *
 * Uses the shared protocol's decodeJournalEntry which handles the server's
 * wire format where event type is in entry.event and payload is without
 * the type field.
 */
export const decodeRoomEventEntry = (entry: EventJournal.Entry): RoomEvent =>
  decodeJournalEntry(entry);

export const roomEventStreamFromEntries = (
  entries: Stream.Stream<EventJournal.Entry>
): Stream.Stream<RoomEvent> => Stream.map(entries, decodeRoomEventEntry);

/**
 * Create IndexedDB-backed journal layer with fallback to memory.
 *
 * IndexedDB persistence ensures events survive page refresh and enables
 * proper reconnection replay. Falls back to memory if IndexedDB is
 * unavailable (e.g., private browsing, storage quota exceeded).
 *
 * @see docs/ARCHITECTURE.md - Invariant #1: EventLog is source of truth
 */
const makeJournalLayer = (roomId: string) =>
  EventJournal.layerIndexedDb({ database: `ensayo-room-${roomId}` }).pipe(
    Layer.catchAll((error) => {
      console.warn(
        `IndexedDB unavailable for room ${roomId}, falling back to memory:`,
        error
      );
      return EventJournal.layerMemory;
    })
  );

const makeRoomEventLayer = (roomId: string, url: string) => {
  const identityLayer = Layer.effect(EventLog.Identity, makeRoomIdentity(roomId)).pipe(
    Layer.provideMerge(EventLogEncryption.layerSubtle)
  );
  const base = Layer.mergeAll(
    makeJournalLayer(roomId),
    Socket.layerWebSocketConstructorGlobal,
    identityLayer
  );
  const eventLogLayer = EventLog.layerEventLog.pipe(Layer.provideMerge(base));
  return EventLogRemote.layerWebSocket(url).pipe(Layer.provideMerge(eventLogLayer));
};

export const makeRoomEventStream = (options: { roomId: string; url: string }) =>
  Stream.unwrapScoped(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const changes = yield* journal.changes;
      return roomEventStreamFromEntries(Stream.fromQueue(changes));
    })
  ).pipe(Stream.provideLayer(makeRoomEventLayer(options.roomId, options.url)));

// =============================================================================
// Connection Status Tracking
// =============================================================================

export const initialConnectionState: ConnectionState = {
  status: "connecting",
  lastConnectedAt: null,
  reconnectAttempts: 0,
  lastError: null
};

/**
 * Create a WebSocket constructor that tracks connection status.
 * Wraps the global WebSocket to emit status changes via the provided ref.
 *
 * Uses Effect.runFork to update the ref from synchronous WebSocket event handlers.
 */
const makeTrackedWebSocketConstructor = (
  statusRef: SubscriptionRef.SubscriptionRef<ConnectionState>
): ((url: string, protocols?: string | Array<string>) => globalThis.WebSocket) => {
  return (url, protocols) => {
    const ws = new globalThis.WebSocket(url, protocols);

    ws.addEventListener("open", () => {
      Effect.runFork(
        SubscriptionRef.set(statusRef, {
          status: "connected",
          lastConnectedAt: Date.now(),
          reconnectAttempts: 0,
          lastError: null
        })
      );
    });

    ws.addEventListener("close", (event) => {
      // Only update if not a normal close (code 1000)
      if (event.code !== 1000) {
        Effect.runFork(
          SubscriptionRef.update(statusRef, (state): ConnectionState => ({
            ...state,
            status: "reconnecting" as const,
            reconnectAttempts: state.reconnectAttempts + 1,
            lastError: event.reason || `WebSocket closed with code ${event.code}`
          }))
        );
      }
    });

    ws.addEventListener("error", () => {
      Effect.runFork(
        SubscriptionRef.update(statusRef, (state): ConnectionState => ({
          ...state,
          status: "reconnecting" as const,
          reconnectAttempts: state.reconnectAttempts + 1,
          lastError: "WebSocket error"
        }))
      );
    });

    return ws;
  };
};

/**
 * Create a layer that provides a tracked WebSocket constructor.
 */
const makeTrackedWebSocketLayer = (
  statusRef: SubscriptionRef.SubscriptionRef<ConnectionState>
): Layer.Layer<Socket.WebSocketConstructor> =>
  Layer.succeed(
    Socket.WebSocketConstructor,
    makeTrackedWebSocketConstructor(statusRef)
  );

/**
 * Create the room event layer with connection status tracking.
 */
const makeTrackedRoomEventLayer = (
  roomId: string,
  url: string,
  statusRef: SubscriptionRef.SubscriptionRef<ConnectionState>
) => {
  const identityLayer = Layer.effect(EventLog.Identity, makeRoomIdentity(roomId)).pipe(
    Layer.provideMerge(EventLogEncryption.layerSubtle)
  );
  const base = Layer.mergeAll(
    makeJournalLayer(roomId),
    makeTrackedWebSocketLayer(statusRef),
    identityLayer
  );
  const eventLogLayer = EventLog.layerEventLog.pipe(Layer.provideMerge(base));
  return EventLogRemote.layerWebSocket(url).pipe(Layer.provideMerge(eventLogLayer));
};

/**
 * Result from creating a room event stream with connection tracking.
 */
export type RoomEventStreamWithStatus = {
  readonly events: Stream.Stream<RoomEvent>;
  readonly connectionStatus: Stream.Stream<ConnectionState>;
};

/**
 * Create a room event stream with connection status tracking.
 *
 * Returns both the event stream and a connection status stream that can be
 * used to display connection state in the UI.
 *
 * EventLogRemote handles reconnection internally with exponential backoff
 * (100ms to 5s max). This wrapper surfaces that status to the UI.
 */
export const makeRoomEventStreamWithStatus = Effect.fn(function* (options: {
  roomId: string;
  url: string;
}) {
  // Create a subscription ref to track connection status
  const statusRef = yield* SubscriptionRef.make(initialConnectionState);

  // Create the event stream with tracked WebSocket
  const events = Stream.unwrapScoped(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const changes = yield* journal.changes;
      return roomEventStreamFromEntries(Stream.fromQueue(changes));
    })
  ).pipe(
    Stream.provideLayer(makeTrackedRoomEventLayer(options.roomId, options.url, statusRef))
  );

  // Create a stream from the status ref changes (instance property)
  const connectionStatus = statusRef.changes;

  return { events, connectionStatus };
});

// =============================================================================
// Shared Room Connection Manager
// =============================================================================

/**
 * Cached room connection with shared resources.
 * Ensures only one WebSocket connection per room across all consumers.
 */
export type RoomConnection = {
  readonly roomId: string;
  readonly statusRef: SubscriptionRef.SubscriptionRef<ConnectionState>;
  readonly layer: Layer.Layer<EventJournal.EventJournal>;
};

// Module-level cache for room connections
const roomConnections = new Map<string, RoomConnection>();

/**
 * Get or create a shared room connection.
 *
 * This is the key optimization: instead of each atom creating its own
 * WebSocket connection, they all share the same connection via this cache.
 *
 * The SubscriptionRef is created synchronously (it's just an in-memory ref),
 * and the Layer lazily initializes the actual WebSocket when the
 * first stream consumer starts.
 */
export const getOrCreateRoomConnection = (roomId: string): RoomConnection => {
  const existing = roomConnections.get(roomId);
  if (existing) {
    return existing;
  }

  // Create status ref synchronously (it's just an in-memory ref)
  const statusRef = Effect.runSync(SubscriptionRef.make(initialConnectionState));
  const url = getRoomStreamUrl(roomId);
  const layer = makeTrackedRoomEventLayer(roomId, url, statusRef);

  const connection: RoomConnection = { roomId, statusRef, layer };
  roomConnections.set(roomId, connection);

  return connection;
};

/**
 * Get the event stream from a shared connection.
 * All consumers of the same roomId share the same WebSocket.
 */
export const getRoomEventStream = (roomId: string): Stream.Stream<RoomEvent> => {
  const connection = getOrCreateRoomConnection(roomId);
  return Stream.unwrapScoped(
    Effect.gen(function* () {
      const journal = yield* EventJournal.EventJournal;
      const changes = yield* journal.changes;
      return roomEventStreamFromEntries(Stream.fromQueue(changes));
    })
  ).pipe(
    Stream.tap((event) => Effect.sync(() => console.info("RoomEvent", event))),
    Stream.provideLayer(connection.layer)
  );
};

/**
 * Get the connection status stream from a shared connection.
 * Uses the same SubscriptionRef that the WebSocket wrapper updates.
 */
export const getRoomConnectionStatus = (roomId: string): Stream.Stream<ConnectionState> => {
  const connection = getOrCreateRoomConnection(roomId);
  return connection.statusRef.changes;
};

/**
 * Clear a room connection from the cache.
 * The actual WebSocket cleanup happens when the stream consumers end.
 * Call this when navigating away from a room.
 */
export const clearRoomConnection = (roomId: string): void => {
  roomConnections.delete(roomId);
};

/**
 * Clear all room connections from the cache.
 * Useful for cleanup during testing.
 */
export const clearAllRoomConnections = (): void => {
  roomConnections.clear();
};
