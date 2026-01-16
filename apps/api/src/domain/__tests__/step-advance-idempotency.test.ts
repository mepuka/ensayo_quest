/**
 * Tests for StepAdvanceIdempotency service interface
 *
 * These tests verify that the idempotency logic prevents double-advance
 * on retry (Architecture Invariant #5).
 *
 * Uses an in-memory Map implementation to test the service interface
 * without requiring a real SqlClient.
 */
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { StepAdvanceIdempotency } from "../RoomEventHandlers";
import { RoomEventHandlerError } from "../RoomEventGroup";

/**
 * In-memory implementation of StepAdvanceIdempotency for testing.
 * Uses a Map to store recorded advances.
 */
const makeTestIdempotencyLayer = () => {
  const advances = new Map<string, { toStepIndex: number; advancedAt: number }>();

  return Layer.succeed(StepAdvanceIdempotency, {
    hasAdvanced: (roomId: string, fromStepIndex: number) =>
      Effect.sync(() => advances.has(`${roomId}:${fromStepIndex}`)),

    recordAdvance: Effect.fn(function* (roomId: string, fromStepIndex: number, toStepIndex: number) {
      const key = `${roomId}:${fromStepIndex}`;
      if (advances.has(key)) {
        return yield* new RoomEventHandlerError({
          operation: "recordAdvance",
          roomId,
          cause: new Error("PRIMARY KEY constraint violation")
        });
      }
      advances.set(key, { toStepIndex, advancedAt: Date.now() });
    })
  });
};

describe("StepAdvanceIdempotency", () => {
  test("hasAdvanced returns false for new room", async () => {
    const layer = makeTestIdempotencyLayer();

    const program = Effect.gen(function* () {
      const idempotency = yield* StepAdvanceIdempotency;
      return yield* idempotency.hasAdvanced("room-1", 0);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer))
    );

    expect(result).toBe(false);
  });

  test("hasAdvanced returns true after recordAdvance", async () => {
    const layer = makeTestIdempotencyLayer();

    const program = Effect.gen(function* () {
      const idempotency = yield* StepAdvanceIdempotency;
      yield* idempotency.recordAdvance("room-1", 0, 1);
      return yield* idempotency.hasAdvanced("room-1", 0);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer))
    );

    expect(result).toBe(true);
  });

  test("different fromStepIndex does not conflict", async () => {
    const layer = makeTestIdempotencyLayer();

    const program = Effect.gen(function* () {
      const idempotency = yield* StepAdvanceIdempotency;
      yield* idempotency.recordAdvance("room-1", 0, 1);
      // Step 1 should not be marked as advanced yet
      return yield* idempotency.hasAdvanced("room-1", 1);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer))
    );

    expect(result).toBe(false);
  });

  test("different roomId does not conflict", async () => {
    const layer = makeTestIdempotencyLayer();

    const program = Effect.gen(function* () {
      const idempotency = yield* StepAdvanceIdempotency;
      yield* idempotency.recordAdvance("room-1", 0, 1);
      // Different room should not be affected
      return yield* idempotency.hasAdvanced("room-2", 0);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer))
    );

    expect(result).toBe(false);
  });

  test("duplicate recordAdvance fails", async () => {
    const layer = makeTestIdempotencyLayer();

    const program = Effect.gen(function* () {
      const idempotency = yield* StepAdvanceIdempotency;
      yield* idempotency.recordAdvance("room-1", 0, 1);
      // This should fail due to duplicate key
      yield* idempotency.recordAdvance("room-1", 0, 1);
    });

    const result = await Effect.runPromiseExit(
      program.pipe(Effect.provide(layer))
    );

    expect(result._tag).toBe("Failure");
  });

  test("sequential advances work correctly", async () => {
    const layer = makeTestIdempotencyLayer();

    const program = Effect.gen(function* () {
      const idempotency = yield* StepAdvanceIdempotency;
      // Advance through multiple steps
      yield* idempotency.recordAdvance("room-1", 0, 1);
      yield* idempotency.recordAdvance("room-1", 1, 2);
      yield* idempotency.recordAdvance("room-1", 2, 3);

      // All should be marked as advanced
      const step0 = yield* idempotency.hasAdvanced("room-1", 0);
      const step1 = yield* idempotency.hasAdvanced("room-1", 1);
      const step2 = yield* idempotency.hasAdvanced("room-1", 2);
      // Step 3 not yet advanced
      const step3 = yield* idempotency.hasAdvanced("room-1", 3);

      return { step0, step1, step2, step3 };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(layer))
    );

    expect(result).toEqual({
      step0: true,
      step1: true,
      step2: true,
      step3: false
    });
  });
});
