import { it, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { Effect, Stream, Chunk, Fiber, Exit } from "effect";
import {
  TranscriptionService,
  TranscriptionServiceLive,
  TranscriptionServiceConfigured,
  ModelLoadError,
  TranscriptionError,
  type LoadProgress
} from "../TranscriptionService";

// =============================================================================
// Mock State
// =============================================================================

let mockPipelineCallCount = 0;
let mockTranscribeCallCount = 0;
let capturedProgressCallback: ((info: LoadProgress) => void) | null = null;
let mockTranscriptResult = "Hola mundo";

// Mock pipeline function
const mockPipeline = async (
  audio: { audio: Float32Array; sampling_rate: number },
  options?: { language?: string; task?: string }
) => {
  mockTranscribeCallCount++;
  return { text: mockTranscriptResult };
};

// Mock the @huggingface/transformers module
mock.module("@huggingface/transformers", () => ({
  pipeline: async (
    task: string,
    model: string,
    options?: { progress_callback?: (info: LoadProgress) => void }
  ) => {
    mockPipelineCallCount++;
    capturedProgressCallback = options?.progress_callback ?? null;

    // Simulate progress events
    if (capturedProgressCallback) {
      capturedProgressCallback({ status: "download", progress: 0 });
      capturedProgressCallback({ status: "progress", progress: 50 });
      capturedProgressCallback({ status: "done" });
    }

    return mockPipeline;
  }
}));

// Reset mocks before each test
beforeEach(() => {
  mockPipelineCallCount = 0;
  mockTranscribeCallCount = 0;
  capturedProgressCallback = null;
  mockTranscriptResult = "Hola mundo";
});

// =============================================================================
// Tests
// =============================================================================

describe("TranscriptionService", () => {
  it("creates a TranscriptionService with required methods", async () => {
    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;
      expect(service.transcribe).toBeDefined();
      expect(service.loadProgress).toBeDefined();
      expect(service.isModelReady).toBeDefined();
      expect(service.preload).toBeDefined();
    });

    await Effect.runPromise(program.pipe(Effect.provide(TranscriptionServiceLive)));
  });

  it("transcribes audio to text", async () => {
    const testAudio = new Float32Array([0.1, 0.2, 0.3]);

    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;
      const result = yield* service.transcribe(testAudio, 16000);
      return result;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TranscriptionServiceLive))
    );

    expect(result).toBe("Hola mundo");
    expect(mockTranscribeCallCount).toBe(1);
  });

  it("loads model only once (single-flight)", async () => {
    const testAudio = new Float32Array([0.1, 0.2, 0.3]);

    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;

      // Multiple transcriptions should only load model once
      yield* service.transcribe(testAudio, 16000);
      yield* service.transcribe(testAudio, 16000);
      yield* service.transcribe(testAudio, 16000);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TranscriptionServiceLive)));

    // Model should only be loaded once
    expect(mockPipelineCallCount).toBe(1);
    // But transcribe should be called 3 times
    expect(mockTranscribeCallCount).toBe(3);
  });

  it("handles concurrent transcribe calls with single-flight model load", async () => {
    const testAudio = new Float32Array([0.1, 0.2, 0.3]);

    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;

      // Start multiple transcriptions concurrently
      const fiber1 = yield* service.transcribe(testAudio, 16000).pipe(Effect.fork);
      const fiber2 = yield* service.transcribe(testAudio, 16000).pipe(Effect.fork);
      const fiber3 = yield* service.transcribe(testAudio, 16000).pipe(Effect.fork);

      // Wait for all to complete
      yield* Fiber.join(fiber1);
      yield* Fiber.join(fiber2);
      yield* Fiber.join(fiber3);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TranscriptionServiceLive)));

    // Model should only be loaded once despite concurrent calls
    expect(mockPipelineCallCount).toBe(1);
  });

  it("reports model ready status", async () => {
    const testAudio = new Float32Array([0.1]);

    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;

      // Before transcription, model is not ready
      const beforeReady = yield* service.isModelReady;

      // Transcribe to trigger model load
      yield* service.transcribe(testAudio, 16000);

      // After transcription, model is ready
      const afterReady = yield* service.isModelReady;

      return { beforeReady, afterReady };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TranscriptionServiceLive))
    );

    expect(result.beforeReady).toBe(false);
    expect(result.afterReady).toBe(true);
  });

  it("supports preloading the model", async () => {
    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;

      // Model not ready initially
      const beforePreload = yield* service.isModelReady;
      expect(beforePreload).toBe(false);

      // Preload the model
      yield* service.preload;

      // Model is now ready
      const afterPreload = yield* service.isModelReady;
      expect(afterPreload).toBe(true);

      // Preloading again should not reload
      yield* service.preload;
      expect(mockPipelineCallCount).toBe(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TranscriptionServiceLive)));
  });

  it("emits progress events during model loading", async () => {
    const progressEvents: LoadProgress[] = [];

    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;

      // Start collecting progress events
      const progressFiber = yield* Stream.take(service.loadProgress, 5).pipe(
        Stream.runCollect,
        Effect.fork
      );

      // Trigger model load
      yield* service.preload;

      // Wait a bit for events to propagate
      yield* Effect.sleep("50 millis");

      // Get collected events
      const chunk = yield* Fiber.join(progressFiber);
      return Chunk.toArray(chunk);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TranscriptionServiceLive))
    );

    // Should have received progress events
    expect(result.length).toBeGreaterThan(0);
    // First event should be "initiate"
    expect(result[0]!.status).toBe("initiate");
    // Last event should be "ready"
    expect(result[result.length - 1]!.status).toBe("ready");
  });

  it("accepts custom configuration", async () => {
    // This test verifies that custom config is supported by the layer
    // We can't easily capture the model used due to mock limitations,
    // but we can verify the service initializes with custom config
    const customLayer = TranscriptionServiceConfigured({
      model: "Xenova/whisper-small",
      language: "english"
    });

    const program = Effect.gen(function* () {
      const service = yield* TranscriptionService;
      // If the layer builds successfully with custom config, the test passes
      yield* service.preload;
      expect(yield* service.isModelReady).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(customLayer)));
  });

  // Note: Testing array results would require a more complex mock setup.
  // The implementation handles both single object and array results correctly.
  // This is verified by code inspection of the transcribe method.
});

describe("TranscriptionService error handling", () => {
  it("ModelLoadError schema is well-formed", () => {
    const error = new ModelLoadError({ reason: "test error" });
    expect(error._tag).toBe("ModelLoadError");
    expect(error.reason).toBe("test error");
  });

  it("TranscriptionError schema is well-formed", () => {
    const error = new TranscriptionError({ reason: "test error" });
    expect(error._tag).toBe("TranscriptionError");
    expect(error.reason).toBe("test error");
  });
});
