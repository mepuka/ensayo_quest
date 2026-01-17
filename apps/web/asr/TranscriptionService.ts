/**
 * TranscriptionService - Effect-native wrapper around @huggingface/transformers
 *
 * Uses Effect.cached (memoize) for single-flight model loading to prevent
 * concurrent downloads. Provides progress events via Queue.sliding.
 *
 * @see docs/plans/2026-01-16-frontend-voice-stack-design.md - Section 7
 * @see docs/ARCHITECTURE.md - Effect patterns
 */
import { Context, Effect, Layer, Ref, Stream, Schema, Queue } from "effect";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error during model loading.
 * Includes dynamic import failures and model download failures.
 */
export class ModelLoadError extends Schema.TaggedError<ModelLoadError>()(
  "ModelLoadError",
  { reason: Schema.String }
) {}

/**
 * Error during transcription.
 * Wraps underlying inference errors.
 */
export class TranscriptionError extends Schema.TaggedError<TranscriptionError>()(
  "TranscriptionError",
  { reason: Schema.String }
) {}

// =============================================================================
// Progress Types
// =============================================================================

/**
 * Progress events emitted during model loading.
 * Used for UI feedback (progress bars, status messages).
 */
export type LoadProgress = {
  readonly status: "initiate" | "download" | "progress" | "done" | "ready";
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
};

// =============================================================================
// Configuration
// =============================================================================

/**
 * TranscriptionService configuration options.
 */
export interface TranscriptionServiceOptions {
  /**
   * Model ID to load.
   * @default "Xenova/whisper-base"
   */
  readonly model?: string;

  /**
   * Target language for transcription.
   * @default "spanish"
   */
  readonly language?: string;

  /**
   * Queue capacity for progress events.
   * @default 32
   */
  readonly progressQueueSize?: number;
}

export class TranscriptionConfig extends Context.Tag("TranscriptionConfig")<
  TranscriptionConfig,
  TranscriptionServiceOptions
>() {}

/**
 * Default transcription configuration.
 */
export const defaultTranscriptionConfig: TranscriptionServiceOptions = {
  model: "Xenova/whisper-base",
  language: "spanish",
  progressQueueSize: 32
};

// =============================================================================
// Service Interface
// =============================================================================

/**
 * TranscriptionService interface.
 *
 * Provides:
 * - transcribe: Convert audio to text
 * - loadProgress: Stream of loading progress events
 * - isModelReady: Check if model is loaded
 */
export interface TranscriptionServiceImpl {
  /**
   * Transcribe audio to text.
   * Model is loaded lazily on first call (single-flight).
   * Can fail with ModelLoadError (on first call) or TranscriptionError.
   */
  readonly transcribe: (
    audio: Float32Array,
    sampleRate: number
  ) => Effect.Effect<string, ModelLoadError | TranscriptionError>;

  /**
   * Stream of loading progress events.
   * Subscribe to show progress UI during model download.
   */
  readonly loadProgress: Stream.Stream<LoadProgress>;

  /**
   * Check if the model is ready.
   */
  readonly isModelReady: Effect.Effect<boolean>;

  /**
   * Eagerly load the model.
   * Call this during app initialization for better UX.
   */
  readonly preload: Effect.Effect<void, ModelLoadError>;
}

export class TranscriptionService extends Context.Tag("TranscriptionService")<
  TranscriptionService,
  TranscriptionServiceImpl
>() {}

// =============================================================================
// Pipeline Type
// =============================================================================

/**
 * Type for the Transformers.js ASR pipeline.
 * Using 'any' since the exact type depends on the transformers.js version.
 */
type Pipeline = (
  audio: Float32Array | { audio: Float32Array; sampling_rate: number },
  options?: { language?: string; task?: string }
) => Promise<{ text: string } | Array<{ text: string }>>;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create the TranscriptionService implementation.
 *
 * Uses Effect.cached for single-flight model loading:
 * - First call loads the model
 * - Concurrent calls wait for the same load to complete
 * - Subsequent calls return cached model
 *
 * This prevents multiple downloads when the service is accessed concurrently.
 */
const makeTranscriptionService = Effect.gen(function* () {
  // Get config with defaults
  const config = yield* Effect.serviceOption(TranscriptionConfig).pipe(
    Effect.map((opt) => opt._tag === "Some" ? opt.value : defaultTranscriptionConfig)
  );

  // Refs for tracking state
  const modelRef = yield* Ref.make<Pipeline | null>(null);

  // Queue for progress events (sliding drops oldest when full)
  const progressQueue = yield* Queue.sliding<LoadProgress>(config.progressQueueSize ?? 32);

  // Model loader effect (will be memoized)
  const loadModelEffect = Effect.gen(function* () {
    yield* Effect.logInfo("TranscriptionService: Loading model", { model: config.model });

    // Notify start
    yield* Queue.offer(progressQueue, { status: "initiate" });

    // Dynamic import for browser-only code
    const transformers = yield* Effect.tryPromise({
      try: () => import("@huggingface/transformers"),
      catch: (cause) => new ModelLoadError({ reason: `Import failed: ${cause}` })
    });

    // Load the ASR pipeline with progress callback
    const model = yield* Effect.tryPromise({
      try: () =>
        transformers.pipeline(
          "automatic-speech-recognition",
          config.model ?? "Xenova/whisper-base",
          {
            progress_callback: (info: LoadProgress) => {
              // Use unsafeOffer since we're in a callback
              progressQueue.unsafeOffer(info);
            }
          }
        ),
      catch: (cause) => new ModelLoadError({ reason: `Load failed: ${cause}` })
    });

    // Store model and notify ready
    yield* Ref.set(modelRef, model as Pipeline);
    yield* Queue.offer(progressQueue, { status: "ready" });

    yield* Effect.logInfo("TranscriptionService: Model loaded");
    return model as Pipeline;
  });

  // Memoize the model loader - concurrent calls share same result
  // Effect.cached returns Effect<Effect<A>> so we need to flatten once
  const ensureModel = yield* Effect.cached(loadModelEffect);

  // Transcribe implementation with tracing
  const transcribe = Effect.fn("TranscriptionService.transcribe")(function* (
    audio: Float32Array,
    sampleRate: number
  ) {
    // Ensure model is loaded (single-flight)
    const model = yield* ensureModel;

    // Run transcription
    const result = yield* Effect.tryPromise({
      try: () =>
        model(
          { audio, sampling_rate: sampleRate },
          { language: config.language ?? "spanish", task: "transcribe" }
        ),
      catch: (cause) => new TranscriptionError({ reason: `Transcription failed: ${cause}` })
    });

    // Handle both single result and array result formats
    const transcript = Array.isArray(result) ? result[0]?.text ?? "" : result.text;
    return transcript;
  });

  // Preload implementation
  const preload = ensureModel.pipe(Effect.asVoid);

  return {
    transcribe,
    loadProgress: Stream.fromQueue(progressQueue),
    isModelReady: Ref.get(modelRef).pipe(Effect.map((m) => m !== null)),
    preload
  };
});

// =============================================================================
// Layer
// =============================================================================

/**
 * Live layer for TranscriptionService.
 *
 * Usage:
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const service = yield* TranscriptionService;
 *
 *   // Optionally preload model
 *   yield* service.preload;
 *
 *   // Subscribe to progress (in parallel)
 *   yield* Stream.runForEach(service.loadProgress, (progress) =>
 *     Effect.log("Loading:", progress)
 *   ).pipe(Effect.fork);
 *
 *   // Transcribe audio
 *   const text = yield* service.transcribe(audioData, 16000);
 *   console.log("Transcript:", text);
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(TranscriptionServiceLive)));
 * ```
 */
export const TranscriptionServiceLive = Layer.effect(
  TranscriptionService,
  makeTranscriptionService
);

/**
 * Layer with custom configuration.
 *
 * @example
 * ```typescript
 * const customConfig = TranscriptionServiceConfigured({
 *   model: "Xenova/whisper-small",
 *   language: "english"
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(customConfig)));
 * ```
 */
export const TranscriptionServiceConfigured = (config: TranscriptionServiceOptions) =>
  TranscriptionServiceLive.pipe(Layer.provide(Layer.succeed(TranscriptionConfig, config)));
