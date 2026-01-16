import { it, expect, describe, mock, beforeEach } from "bun:test";
import { Effect, Stream, Chunk, Exit, Fiber, Deferred } from "effect";
import {
  VadService,
  VadServiceLive,
  VadServiceConfigured,
  VadInitError,
  type VadEvent
} from "../VadService";

// =============================================================================
// Mock MicVAD
// =============================================================================

interface MockMicVAD {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
  // Test helpers
  _emitSpeechStart: () => void;
  _emitSpeechEnd: (audio: Float32Array) => void;
  _emitFrameProcessed: (isSpeech: number) => void;
}

let mockVadCallbacks: {
  onSpeechStart?: () => void;
  onSpeechEnd?: (audio: Float32Array) => void;
  onFrameProcessed?: (probs: { isSpeech: number }) => void;
} = {};

let mockVadStarted = false;
let mockVadPaused = false;
let mockVadDestroyed = false;

const createMockMicVAD = (): MockMicVAD => ({
  start: async () => {
    mockVadStarted = true;
  },
  pause: async () => {
    mockVadPaused = true;
  },
  destroy: async () => {
    mockVadDestroyed = true;
  },
  _emitSpeechStart: () => {
    mockVadCallbacks.onSpeechStart?.();
  },
  _emitSpeechEnd: (audio: Float32Array) => {
    mockVadCallbacks.onSpeechEnd?.(audio);
  },
  _emitFrameProcessed: (isSpeech: number) => {
    mockVadCallbacks.onFrameProcessed?.({ isSpeech });
  }
});

let currentMockVad: MockMicVAD | null = null;

// Mock the @ricky0123/vad-web module
mock.module("@ricky0123/vad-web", () => ({
  MicVAD: {
    new: async (options: {
      baseAssetPath?: string;
      onnxWASMBasePath?: string;
      model?: string;
      onSpeechStart?: () => void;
      onSpeechEnd?: (audio: Float32Array) => void;
      onFrameProcessed?: (probs: { isSpeech: number }) => void;
    }) => {
      mockVadCallbacks = {
        onSpeechStart: options.onSpeechStart,
        onSpeechEnd: options.onSpeechEnd,
        onFrameProcessed: options.onFrameProcessed
      };
      currentMockVad = createMockMicVAD();
      return currentMockVad;
    }
  }
}));

// Reset mocks before each test
beforeEach(() => {
  mockVadCallbacks = {};
  mockVadStarted = false;
  mockVadPaused = false;
  mockVadDestroyed = false;
  currentMockVad = null;
});

// =============================================================================
// Tests
// =============================================================================

describe("VadService", () => {
  it("creates a VadService with events stream", async () => {
    const program = Effect.gen(function* () {
      const vad = yield* VadService;
      expect(vad.events).toBeDefined();
    });

    // Use scoped to create the service but don't consume the stream
    await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );
  });

  it("emits SpeechStart event when VAD detects speech", async () => {
    const events: VadEvent[] = [];

    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      // Take events in background fiber
      const fiber = yield* Stream.take(vad.events, 1).pipe(
        Stream.runCollect,
        Effect.fork
      );

      // Wait for VAD to start, then emit event
      yield* Effect.sleep("10 millis");
      currentMockVad?._emitSpeechStart();

      // Collect results
      const chunk = yield* Fiber.join(fiber);
      return Chunk.toArray(chunk);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );

    expect(result.length).toBe(1);
    expect(result[0]._tag).toBe("SpeechStart");
  });

  it("emits SpeechEnd event with audio data", async () => {
    const testAudio = new Float32Array([0.1, 0.2, 0.3]);

    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      const fiber = yield* Stream.take(vad.events, 1).pipe(
        Stream.runCollect,
        Effect.fork
      );

      yield* Effect.sleep("10 millis");
      currentMockVad?._emitSpeechEnd(testAudio);

      const chunk = yield* Fiber.join(fiber);
      return Chunk.toArray(chunk);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );

    expect(result.length).toBe(1);
    expect(result[0]._tag).toBe("SpeechEnd");
    if (result[0]._tag === "SpeechEnd") {
      expect(result[0].audio).toEqual(testAudio);
    }
  });

  it("emits FrameProcessed event with probability", async () => {
    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      const fiber = yield* Stream.take(vad.events, 1).pipe(
        Stream.runCollect,
        Effect.fork
      );

      yield* Effect.sleep("10 millis");
      currentMockVad?._emitFrameProcessed(0.85);

      const chunk = yield* Fiber.join(fiber);
      return Chunk.toArray(chunk);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );

    expect(result.length).toBe(1);
    expect(result[0]._tag).toBe("FrameProcessed");
    if (result[0]._tag === "FrameProcessed") {
      expect(result[0].probability).toBe(0.85);
    }
  });

  it("calls vad.start() when stream is consumed", async () => {
    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      // Start consuming events (this triggers VAD start)
      const fiber = yield* Stream.take(vad.events, 1).pipe(
        Stream.runCollect,
        Effect.fork
      );

      // Wait for VAD to start
      yield* Effect.sleep("10 millis");
      expect(mockVadStarted).toBe(true);

      // Clean up
      currentMockVad?._emitSpeechStart();
      yield* Fiber.join(fiber);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );
  });

  it("calls vad.pause() and vad.destroy() when stream consumption completes", async () => {
    // Reset cleanup flags
    mockVadPaused = false;
    mockVadDestroyed = false;

    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      // Verify VAD starts
      expect(mockVadStarted).toBe(false);

      // Start consuming - this triggers VAD start
      const fiber = yield* Stream.take(vad.events, 1).pipe(
        Stream.runCollect,
        Effect.fork
      );

      yield* Effect.sleep("10 millis");

      // VAD should be started now
      expect(mockVadStarted).toBe(true);

      // Emit an event to complete the stream
      currentMockVad?._emitSpeechStart();
      yield* Fiber.join(fiber);

      // After Stream.take completes, the stream's scope closes and cleanup runs
      // This is correct behavior - cleanup happens when stream consumption ends
      expect(mockVadPaused).toBe(true);
      expect(mockVadDestroyed).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );
  });

  it("cleans up when fiber is interrupted", async () => {
    // Reset cleanup flags
    mockVadPaused = false;
    mockVadDestroyed = false;

    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      // Start consuming without limit (would run forever)
      const fiber = yield* Stream.runCollect(vad.events).pipe(Effect.fork);

      yield* Effect.sleep("10 millis");

      // VAD should be running
      expect(mockVadStarted).toBe(true);
      expect(mockVadPaused).toBe(false);

      // Interrupt the fiber - should trigger cleanup
      yield* Fiber.interrupt(fiber);

      // After interruption, cleanup should have run
      expect(mockVadPaused).toBe(true);
      expect(mockVadDestroyed).toBe(true);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );
  });

  it("accepts custom configuration", async () => {
    let capturedConfig: { baseAssetPath?: string; onnxWASMBasePath?: string } =
      {};

    // Override mock to capture config
    const originalNew = (await import("@ricky0123/vad-web")).MicVAD.new;
    (await import("@ricky0123/vad-web")).MicVAD.new = async (options: any) => {
      capturedConfig = options;
      return originalNew(options);
    };

    const customLayer = VadServiceConfigured({
      baseAssetPath: "/custom/vad",
      onnxWASMBasePath: "/custom/onnx"
    });

    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      const fiber = yield* Stream.take(vad.events, 1).pipe(
        Stream.runCollect,
        Effect.fork
      );

      yield* Effect.sleep("10 millis");
      currentMockVad?._emitSpeechStart();
      yield* Fiber.join(fiber);
    });

    await Effect.runPromise(
      program.pipe(
        Effect.provide(customLayer),
        Effect.scoped
      )
    );

    expect(capturedConfig.baseAssetPath).toBe("/custom/vad");
    expect(capturedConfig.onnxWASMBasePath).toBe("/custom/onnx");
  });

  it("handles multiple events in sequence", async () => {
    const program = Effect.gen(function* () {
      const vad = yield* VadService;

      const fiber = yield* Stream.take(vad.events, 3).pipe(
        Stream.runCollect,
        Effect.fork
      );

      yield* Effect.sleep("10 millis");
      currentMockVad?._emitSpeechStart();
      currentMockVad?._emitFrameProcessed(0.9);
      currentMockVad?._emitSpeechEnd(new Float32Array([0.5]));

      const chunk = yield* Fiber.join(fiber);
      return Chunk.toArray(chunk);
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(VadServiceLive),
        Effect.scoped
      )
    );

    expect(result.length).toBe(3);
    expect(result[0]._tag).toBe("SpeechStart");
    expect(result[1]._tag).toBe("FrameProcessed");
    expect(result[2]._tag).toBe("SpeechEnd");
  });
});

describe("VadService error handling", () => {
  it("VadInitError schema is well-formed", () => {
    const error = new VadInitError({ reason: "test error" });
    expect(error._tag).toBe("VadInitError");
    expect(error.reason).toBe("test error");
  });

  // Note: Testing import failures requires integration tests with browser environment.
  // The dynamic import behavior can't be easily mocked in unit tests.
});
