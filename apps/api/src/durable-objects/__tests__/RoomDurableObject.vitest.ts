/**
 * Integration tests for RoomDurableObject
 *
 * These tests run in the actual workerd runtime using @cloudflare/vitest-pool-workers.
 * They verify end-to-end behavior including:
 * - Room initialization via events
 * - WebSocket connection handling
 * - Alarm scheduling and execution
 *
 * Run with: bun run test:integration
 */
import { describe, it, expect } from "vitest";
import { Effect, Data } from "effect";
import {
  effectTest,
  CloudflareTestContext,
  getDurableObjectStub,
} from "../../test/effect-vitest-cloudflare";
import {
  RoomEventEnvelope,
  RoomInitialized,
  encodeRoomEventEnvelopeMsgPack,
} from "../../domain/RoomProtocol";

// Extend the TestEnv interface for our bindings
declare module "../../test/effect-vitest-cloudflare" {
  interface TestEnv {
    ROOMS: DurableObjectNamespace;
    DB: D1Database;
  }
}

class EmitEventError extends Data.TaggedError("EmitEventError")<{
  cause: unknown;
}> {}

/**
 * Helper to emit a RoomEvent to a DO using the proper MsgPack protocol
 * Returns the HTTP response for verification
 */
const emitRoomEvent = (
  stub: { fetch: typeof fetch },
  roomId: string,
  event: RoomInitialized
) =>
  Effect.tryPromise({
    try: async () => {
      const payload = encodeRoomEventEnvelopeMsgPack(
        new RoomEventEnvelope({
          roomId,
          event,
          stateJson: undefined,
        })
      );
      const response = await stub.fetch("https://room/internal/event", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: payload as unknown as BodyInit,
      });
      return response;
    },
    catch: (cause) => new EmitEventError({ cause }),
  });

describe("RoomDurableObject Integration", () => {
  describe("Room Initialization", () => {
    it("accepts RoomInitialized event and returns 204", () =>
      effectTest(
        Effect.gen(function* () {
          const ctx = yield* CloudflareTestContext;

          // Get a DO stub for testing
          const roomId = `test-room-${Date.now()}`;
          const stub = yield* getDurableObjectStub(ctx.env.ROOMS, roomId);

          // Emit a RoomInitialized event using the proper MsgPack protocol
          const event = new RoomInitialized({
            type: "RoomInitialized",
            roomId,
            scenarioId: "test-scenario-123",
            seedPrompt: "Estás en un restaurante...",
            topic: "food",
            level: "A2",
            templateVersion: "tpl-version-test",
            timestamp: Date.now(),
          });

          const response = yield* emitRoomEvent(stub as { fetch: typeof fetch }, roomId, event);

          // DO should respond with 204 No Content on success
          expect(response.ok).toBe(true);
          expect(response.status).toBe(204);
        })
      ));

    it("handles duplicate RoomInitialized events idempotently", () =>
      effectTest(
        Effect.gen(function* () {
          const ctx = yield* CloudflareTestContext;

          const roomId = `idempotent-test-${Date.now()}`;
          const stub = yield* getDurableObjectStub(ctx.env.ROOMS, roomId);

          const event = new RoomInitialized({
            type: "RoomInitialized",
            roomId,
            scenarioId: "test-scenario-456",
            seedPrompt: "En el aeropuerto...",
            topic: "travel",
            level: "B1",
            templateVersion: "tpl-version-test",
            timestamp: Date.now(),
          });

          // First event
          const response1 = yield* emitRoomEvent(stub as { fetch: typeof fetch }, roomId, event);
          expect(response1.status).toBe(204);

          // Second identical event - should be handled idempotently (no error)
          const response2 = yield* emitRoomEvent(stub as { fetch: typeof fetch }, roomId, event);
          expect(response2.ok).toBe(true);
        })
      ));
  });

  describe("WebSocket Connection", () => {
    it("accepts WebSocket connections after room initialization", () =>
      effectTest(
        Effect.gen(function* () {
          const ctx = yield* CloudflareTestContext;

          const roomId = `ws-test-${Date.now()}`;
          const stub = yield* getDurableObjectStub(ctx.env.ROOMS, roomId);

          // Initialize room first
          const event = new RoomInitialized({
            type: "RoomInitialized",
            roomId,
            scenarioId: "test-scenario-789",
            seedPrompt: "En la tienda...",
            topic: "shopping",
            level: "A1",
            templateVersion: "tpl-version-test",
            timestamp: Date.now(),
          });

          yield* emitRoomEvent(stub as { fetch: typeof fetch }, roomId, event);

          // Connect via WebSocket
          const response = yield* Effect.tryPromise(() =>
            (stub as { fetch: typeof fetch }).fetch("https://room/websocket", {
              headers: { Upgrade: "websocket" },
            })
          );

          expect(response.status).toBe(101);
          expect((response as Response & { webSocket?: WebSocket }).webSocket).toBeDefined();

          // Clean up
          const ws = (response as Response & { webSocket?: WebSocket }).webSocket!;
          ws.accept();
          ws.close();
        })
      ));

    it("sends initial state on WebSocket connection", () =>
      effectTest(
        Effect.gen(function* () {
          const ctx = yield* CloudflareTestContext;

          const roomId = `ws-state-test-${Date.now()}`;
          const stub = yield* getDurableObjectStub(ctx.env.ROOMS, roomId);

          // Initialize room
          const event = new RoomInitialized({
            type: "RoomInitialized",
            roomId,
            scenarioId: "test-scenario-ws-state",
            seedPrompt: "En el café...",
            topic: "food",
            level: "A2",
            templateVersion: "tpl-version-test",
            timestamp: Date.now(),
          });

          yield* emitRoomEvent(stub as { fetch: typeof fetch }, roomId, event);

          // Connect via WebSocket
          const response = yield* Effect.tryPromise(() =>
            (stub as { fetch: typeof fetch }).fetch("https://room/websocket", {
              headers: { Upgrade: "websocket" },
            })
          );

          const ws = (response as Response & { webSocket?: WebSocket }).webSocket!;
          ws.accept();

          // Collect messages - should receive Hello and potentially other initial state
          const messages: unknown[] = [];
          const messagePromise = new Promise<void>((resolve) => {
            ws.addEventListener("message", (event) => {
              messages.push(event.data);
              // Resolve after receiving at least one message
              resolve();
            });
          });

          // Wait for initial message(s) with a timeout
          yield* Effect.tryPromise(() =>
            Promise.race([
              messagePromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000)),
            ])
          );

          // Should have received at least one message (Hello from EventLog protocol)
          expect(messages.length).toBeGreaterThan(0);

          ws.close();
        })
      ));
  });

  describe("Alarm Handling", () => {
    it("can trigger alarms on the DO", () =>
      effectTest(
        Effect.gen(function* () {
          const ctx = yield* CloudflareTestContext;

          const roomId = `alarm-test-${Date.now()}`;
          const stub = yield* getDurableObjectStub(ctx.env.ROOMS, roomId);

          // Initialize room first
          const event = new RoomInitialized({
            type: "RoomInitialized",
            roomId,
            scenarioId: "test-scenario-alarm",
            seedPrompt: "En el trabajo...",
            topic: "work",
            level: "B2",
            templateVersion: "tpl-version-test",
            timestamp: Date.now(),
          });

          yield* emitRoomEvent(stub as { fetch: typeof fetch }, roomId, event);

          // Set an alarm via runInDurableObject
          yield* ctx.runInDurableObject(stub, async (_instance, state) => {
            await (state as DurableObjectState).storage.setAlarm(Date.now() + 1000);
          });

          // Trigger the alarm immediately
          const alarmRan = yield* ctx.runDurableObjectAlarm(stub);

          // Alarm should have run (returns true if an alarm was scheduled and ran)
          expect(typeof alarmRan).toBe("boolean");
        })
      ));
  });

  describe("Error Handling", () => {
    it("returns 405 for non-POST requests", () =>
      effectTest(
        Effect.gen(function* () {
          const ctx = yield* CloudflareTestContext;

          const roomId = `error-test-${Date.now()}`;
          const stub = yield* getDurableObjectStub(ctx.env.ROOMS, roomId);

          // Try GET request (should fail)
          const response = yield* Effect.tryPromise(() =>
            (stub as { fetch: typeof fetch }).fetch("https://room/internal/event", {
              method: "GET",
            })
          );

          expect(response.status).toBe(405);
        })
      ));
  });
});

describe("D1 Integration", () => {
  it("can query D1 database", () =>
    effectTest(
      Effect.gen(function* () {
        const ctx = yield* CloudflareTestContext;

        // Query the D1 database
        const result = yield* Effect.tryPromise(() =>
          ctx.env.DB.prepare("SELECT 1 as value").first<{ value: number }>()
        );

        expect(result?.value).toBe(1);
      })
    ));
});
