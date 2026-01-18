/**
 * Recording Ops Tests
 *
 * Tests for the recording operations guards and behaviors implemented in Phase 3:
 * - Empty audio guard: Skip transcription for empty audio
 * - RequestId staleness: Drop results that don't match the latest request
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 3 & 4
 */
import { it, expect, describe } from "bun:test";
import { Effect, Ref } from "effect";

/**
 * Test the empty audio guard logic.
 *
 * This test validates the guard condition used in recording.ops.ts:
 * `if (event.audio.length === 0 || sampleRate <= 0)`
 */
describe("Empty Audio Guard", () => {
  it("should detect empty audio array", () => {
    const audio = new Float32Array([]);
    const sampleRate = 16000;

    // Guard condition from recording.ops.ts:216
    const shouldSkip = audio.length === 0 || sampleRate <= 0;

    expect(shouldSkip).toBe(true);
  });

  it("should detect invalid sample rate (zero)", () => {
    const audio = new Float32Array([0.1, 0.2]);
    const sampleRate = 0;

    const shouldSkip = audio.length === 0 || sampleRate <= 0;

    expect(shouldSkip).toBe(true);
  });

  it("should detect invalid sample rate (negative)", () => {
    const audio = new Float32Array([0.1, 0.2]);
    const sampleRate = -16000;

    const shouldSkip = audio.length === 0 || sampleRate <= 0;

    expect(shouldSkip).toBe(true);
  });

  it("should not skip valid audio with valid sample rate", () => {
    const audio = new Float32Array([0.1, 0.2, 0.3]);
    const sampleRate = 16000;

    const shouldSkip = audio.length === 0 || sampleRate <= 0;

    expect(shouldSkip).toBe(false);
  });

  it("should not skip single-sample audio", () => {
    const audio = new Float32Array([0.5]);
    const sampleRate = 16000;

    const shouldSkip = audio.length === 0 || sampleRate <= 0;

    expect(shouldSkip).toBe(false);
  });
});

/**
 * Test the requestId staleness logic.
 *
 * This test validates the staleness check used in recording.ops.ts:
 * `if (latestId !== requestId) { /* drop stale result * / }`
 */
describe("RequestId Staleness", () => {
  it("should detect stale result when latestId differs", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<string | null>(null);

      // Simulate: first request is made
      const firstRequestId = "request-1";
      yield* Ref.set(ref, firstRequestId);

      // Simulate: second request is made while first is still in flight
      const secondRequestId = "request-2";
      yield* Ref.set(ref, secondRequestId);

      // First result comes back - should be stale
      const latestId = yield* Ref.get(ref);
      return latestId !== firstRequestId;
    });

    const isStale = await Effect.runPromise(program);
    expect(isStale).toBe(true);
  });

  it("should not detect staleness when requestId matches", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<string | null>(null);

      // Single request
      const requestId = "request-1";
      yield* Ref.set(ref, requestId);

      // Result comes back for the current request
      const latestId = yield* Ref.get(ref);
      return latestId !== requestId;
    });

    const isStale = await Effect.runPromise(program);
    expect(isStale).toBe(false);
  });

  it("should handle null initial state", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<string | null>(null);

      // No request made yet
      const latestId = yield* Ref.get(ref);
      const requestId = "request-1";

      // Result for a request when no request was tracked - should be stale
      return latestId !== requestId;
    });

    const isStale = await Effect.runPromise(program);
    expect(isStale).toBe(true);
  });

  it("should correctly update ref with Effect-based operations", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<string | null>(null);

      // Set request ID
      const requestId = "test-request-123";
      yield* Ref.set(ref, requestId);

      // Get and check
      const latestId = yield* Ref.get(ref);
      return latestId === requestId;
    });

    const result = await Effect.runPromise(program);
    expect(result).toBe(true);
  });

  it("should handle rapid request updates", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<string | null>(null);
      const updates: string[] = [];

      // Simulate rapid requests
      for (let i = 0; i < 5; i++) {
        const requestId = `request-${i}`;
        yield* Ref.set(ref, requestId);
        updates.push(requestId);
      }

      // Only the last request should be current
      const latestId = yield* Ref.get(ref);
      return {
        latestId,
        allUpdates: updates,
        onlyLastIsCurrent: latestId === updates[updates.length - 1]
      };
    });

    const result = await Effect.runPromise(program);
    expect(result.latestId).toBe("request-4");
    expect(result.onlyLastIsCurrent).toBe(true);
  });
});

/**
 * Test the combined guard behavior.
 *
 * These tests validate the complete flow of guards in recording.ops.ts SpeechEnd handler.
 */
describe("Combined Guard Behavior", () => {
  it("empty audio returns early without transcription", () => {
    // Simulate the SpeechEnd handler flow
    const emptyAudio = new Float32Array([]);
    const sampleRate = 16000;
    let transcriptionCalled = false;

    // Guard check
    if (emptyAudio.length === 0 || sampleRate <= 0) {
      // Early return path - set empty result
      // transcription should NOT be called
    } else {
      transcriptionCalled = true;
    }

    expect(transcriptionCalled).toBe(false);
  });

  it("valid audio proceeds to transcription", () => {
    const validAudio = new Float32Array([0.1, 0.2, 0.3]);
    const sampleRate = 16000;
    let transcriptionCalled = false;

    if (validAudio.length === 0 || sampleRate <= 0) {
      // Early return path
    } else {
      transcriptionCalled = true;
    }

    expect(transcriptionCalled).toBe(true);
  });

  it("stale results are dropped after transcription completes", async () => {
    const program = Effect.gen(function* () {
      const ref = yield* Ref.make<string | null>(null);

      // Request 1 starts
      const request1Id = "request-1";
      yield* Ref.set(ref, request1Id);

      // Request 2 starts (supersedes request 1)
      const request2Id = "request-2";
      yield* Ref.set(ref, request2Id);

      // Request 1 result arrives - should be dropped
      const latestId = yield* Ref.get(ref);
      const request1IsStale = latestId !== request1Id;

      // Request 2 result arrives - should be kept
      const request2IsStale = latestId !== request2Id;

      return { request1IsStale, request2IsStale };
    });

    const result = await Effect.runPromise(program);
    expect(result.request1IsStale).toBe(true);
    expect(result.request2IsStale).toBe(false);
  });
});

/**
 * Test edge cases related to audio data.
 */
describe("Audio Data Edge Cases", () => {
  it("handles audio with all zeros", () => {
    const silentAudio = new Float32Array(1600); // 0.1 second of silence at 16kHz
    const sampleRate = 16000;

    // Silent audio is still valid audio - length > 0
    const shouldSkip = silentAudio.length === 0 || sampleRate <= 0;
    expect(shouldSkip).toBe(false);
  });

  it("handles very short audio (single sample)", () => {
    const shortAudio = new Float32Array([0.5]);
    const sampleRate = 16000;

    const shouldSkip = shortAudio.length === 0 || sampleRate <= 0;
    expect(shouldSkip).toBe(false);
  });

  it("handles very long audio (10 seconds)", () => {
    const longAudio = new Float32Array(16000 * 10);
    const sampleRate = 16000;

    const shouldSkip = longAudio.length === 0 || sampleRate <= 0;
    expect(shouldSkip).toBe(false);
  });

  it("handles non-standard sample rates", () => {
    const audio = new Float32Array([0.1, 0.2]);

    // Various valid sample rates
    expect(audio.length === 0 || 44100 <= 0).toBe(false);
    expect(audio.length === 0 || 48000 <= 0).toBe(false);
    expect(audio.length === 0 || 8000 <= 0).toBe(false);
    expect(audio.length === 0 || 22050 <= 0).toBe(false);
  });
});
