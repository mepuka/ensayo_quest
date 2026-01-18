/**
 * VadService - Effect-native wrapper around @ricky0123/vad-web
 *
 * Uses VAD-only capture pattern where MicVAD owns the microphone.
 * Implements Stream.asyncScoped for proper cleanup on scope end.
 *
 * @see docs/plans/2026-01-16-frontend-voice-stack-design.md - Section 7
 * @see docs/ARCHITECTURE.md - Effect patterns
 */
import { Context, Effect, Layer, Stream, Schema } from "effect";

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error during VAD initialization.
 * Includes dynamic import failures, MicVAD construction, and start failures.
 */
export class VadInitError extends Schema.TaggedError<VadInitError>()(
  "VadInitError",
  { reason: Schema.String }
) {}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Events emitted by the VAD service.
 *
 * - SpeechStart: Speech detected, recording has begun
 * - SpeechEnd: Speech ended, includes Float32Array audio at 16kHz
 * - FrameProcessed: Real-time probability for UI feedback
 */
export type VadEvent =
  | { readonly _tag: "SpeechStart"; readonly timestamp: number }
  | { readonly _tag: "SpeechEnd"; readonly timestamp: number; readonly audio: Float32Array }
  | { readonly _tag: "FrameProcessed"; readonly probability: number };

// =============================================================================
// Configuration
// =============================================================================

/**
 * VAD service configuration options.
 * Extends vad-web MicVADOptions with typed config.
 */
export interface VadServiceOptions {
  /**
   * Base path for VAD assets (worklet JS).
   * @default "/vad"
   */
  readonly baseAssetPath?: string;

  /**
   * Base path for ONNX WASM files.
   * @default "/vad/onnx"
   */
  readonly onnxWASMBasePath?: string;

  /**
   * VAD model version.
   * @default "legacy"
   */
  readonly model?: "v5" | "legacy";

  // Frame processor options from vad-web
  /**
   * Speech probability threshold (0-1). Higher = stricter detection.
   * @default 0.5
   */
  readonly positiveSpeechThreshold?: number;

  /**
   * Probability below which speech is considered ended.
   * @default 0.35
   */
  readonly negativeSpeechThreshold?: number;

  /**
   * Time in ms to wait after speech ends before triggering SpeechEnd.
   * Allows for pauses and hesitation.
   * @default 500
   */
  readonly redemptionFrames?: number;

  /**
   * Padding in ms to add before detected speech start.
   * @default 500
   */
  readonly preSpeechPadFrames?: number;

  /**
   * Minimum speech duration in ms to trigger a valid segment.
   * @default 250
   */
  readonly minSpeechFrames?: number;

  /**
   * Submit speech on pause (vs only on explicit stop).
   * @default true
   */
  readonly submitUserSpeechOnPause?: boolean;
}

export class VadConfig extends Context.Tag("VadConfig")<VadConfig, VadServiceOptions>() {}

/**
 * Default VAD configuration.
 */
export const defaultVadConfig: VadServiceOptions = {
  baseAssetPath: "/vad",
  onnxWASMBasePath: "/vad/onnx",
  model: "legacy"
};

// =============================================================================
// Service Interface
// =============================================================================

/**
 * VAD service interface.
 *
 * Provides a Stream of VadEvents. Lifecycle is automatic:
 * - VAD starts when stream is consumed
 * - VAD cleans up (pause + destroy) when stream scope ends
 *
 * Anti-pattern avoided: No start/stop methods that require manual lifecycle management.
 */
export interface VadServiceImpl {
  /**
   * Stream of VAD events.
   * Consuming this stream starts the VAD; scope end triggers cleanup.
   */
  readonly events: Stream.Stream<VadEvent, VadInitError>;
}

export class VadService extends Context.Tag("VadService")<VadService, VadServiceImpl>() {}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create the VAD service implementation.
 *
 * Uses Stream.asyncScoped (NOT asyncPush!) for scoped resource management.
 * The register function uses Effect.addFinalizer to register cleanup that
 * runs when the stream's scope ends.
 *
 * Pattern:
 * - register() uses Effect.addFinalizer() to register cleanup
 * - Cleanup runs when stream scope ends (consumer cancels, stream completes, or error)
 * - This ensures vad.pause() and vad.destroy() are always called
 */
const makeVadService = Effect.gen(function* () {
  // Get config with defaults
  const config = yield* Effect.serviceOption(VadConfig).pipe(
    Effect.map((opt) => opt._tag === "Some" ? opt.value : defaultVadConfig)
  );

  const events = Stream.asyncScoped<VadEvent, VadInitError>(
    Effect.fnUntraced(function* (emit) {
        // Dynamic import for browser-only code
        // This prevents SSR/Node.js from attempting to load browser APIs
        const VadWeb = yield* Effect.tryPromise({
          try: () => import("@ricky0123/vad-web"),
          catch: (cause) => new VadInitError({ reason: `Import failed: ${cause}` })
        });

        // Build VAD instance with asset paths and frame processor options
        // MicVAD.new() handles:
        // - Microphone access via getUserMedia
        // - AudioWorklet setup
        // - Silero VAD model loading
        const vad = yield* Effect.tryPromise({
          try: () =>
            VadWeb.MicVAD.new({
              // Asset paths - must match server static file routes
              baseAssetPath: config.baseAssetPath ?? "/vad",
              onnxWASMBasePath: config.onnxWASMBasePath ?? "/vad/onnx",
              model: config.model ?? "legacy",

              // Frame processor options for language learner tuning
              positiveSpeechThreshold: config.positiveSpeechThreshold ?? 0.5,
              negativeSpeechThreshold: config.negativeSpeechThreshold ?? 0.35,
              redemptionFrames: config.redemptionFrames ?? 8,
              preSpeechPadFrames: config.preSpeechPadFrames ?? 1,
              minSpeechFrames: config.minSpeechFrames ?? 3,
              submitUserSpeechOnPause: config.submitUserSpeechOnPause ?? true,

              // Event callbacks - emit to Stream
              onSpeechStart: () => {
                emit.single({ _tag: "SpeechStart", timestamp: Date.now() });
              },
              onSpeechEnd: (audio: Float32Array) => {
                emit.single({ _tag: "SpeechEnd", timestamp: Date.now(), audio });
              },
              onFrameProcessed: (probs: { isSpeech: number }) => {
                emit.single({ _tag: "FrameProcessed", probability: probs.isSpeech });
              }
            }),
          catch: (cause) => new VadInitError({ reason: `VAD init failed: ${cause}` })
        });

        // Register cleanup via addFinalizer - this is how asyncScoped handles cleanup
        // The cleanup runs when the stream's scope ends
        yield* Effect.addFinalizer(
          Effect.fnUntraced(function* () {
            yield* Effect.logInfo("VadService cleaning up");
            // pause() stops processing but keeps resources
            yield* Effect.promise(() => vad.pause());
            // destroy() releases all resources (AudioContext, MediaStream, etc.)
            yield* Effect.promise(() => vad.destroy());
            yield* Effect.logInfo("VadService destroyed");
          })
        );

        // Start listening (requests microphone permission if needed)
        yield* Effect.tryPromise({
          try: () => vad.start(),
          catch: (cause) => new VadInitError({ reason: `VAD start failed: ${cause}` })
        });

        yield* Effect.logInfo("VadService started");
      }),
    // Buffer strategy: sliding drops old events to maintain real-time behavior
    // This prevents backpressure from blocking the audio pipeline
    { bufferSize: 64, strategy: "sliding" }
  );

  return { events };
});

// =============================================================================
// Layer
// =============================================================================

/**
 * Live layer for VadService.
 *
 * Layer.scoped ensures:
 * 1. Service is created when layer is provided
 * 2. Stream cleanup runs when the providing scope closes
 *
 * Usage:
 * ```typescript
 * const program = Effect.gen(function* () {
 *   const vad = yield* VadService;
 *   yield* Stream.runForEach(vad.events, (event) => {
 *     // Handle VAD events
 *   });
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(VadServiceLive)));
 * ```
 */
export const VadServiceLive = Layer.scoped(VadService, makeVadService);

/**
 * Layer with custom configuration.
 *
 * @example
 * ```typescript
 * const customConfig = VadServiceConfigured({
 *   baseAssetPath: "/custom/vad",
 *   onnxWASMBasePath: "/custom/vad/onnx"
 * });
 *
 * Effect.runPromise(program.pipe(Effect.provide(customConfig)));
 * ```
 */
export const VadServiceConfigured = (config: VadServiceOptions) =>
  VadServiceLive.pipe(Layer.provide(Layer.succeed(VadConfig, config)));
