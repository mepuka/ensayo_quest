/**
 * Protocol Schema Tests
 *
 * Tests for the TaggedRequest protocol schemas used in serialized worker communication.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 4
 */
import { it, expect, describe } from "bun:test";
import * as Schema from "effect/Schema";
import {
  Preload,
  Transcribe,
  TranscribeResult,
  PreloadComplete,
  PreloadProgress,
  ASRWorkerRequest,
  PreloadEvent,
  ASRConfigPayload
} from "../worker/protocol";
import { TranscriptionFailed } from "../errors";

describe("Protocol Schemas", () => {
  describe("Preload request", () => {
    it("creates a Preload request with requestId", () => {
      const preload = new Preload({ requestId: "test-123", config: undefined });
      expect(preload._tag).toBe("Preload");
      expect(preload.requestId).toBe("test-123");
    });

    it("creates a Preload request with config", () => {
      const config = new ASRConfigPayload({
        model: "whisper-base",
        language: "es",
        sampleRate: 16000
      });
      const preload = new Preload({ requestId: "test-456", config });
      expect(preload.config?.model).toBe("whisper-base");
      expect(preload.config?.language).toBe("es");
    });

    it("Preload request has correct TaggedRequest structure", () => {
      const preload = new Preload({ requestId: "test-789", config: undefined });
      // TaggedRequest classes have success/failure types defined
      expect(preload._tag).toBe("Preload");
    });
  });

  describe("Transcribe request", () => {
    it("creates a Transcribe request with audio data", () => {
      const audio = new Float32Array([0.1, 0.2, 0.3]);
      const transcribe = new Transcribe({
        requestId: "test-456",
        audio,
        sampleRate: 16000,
        config: undefined
      });
      expect(transcribe._tag).toBe("Transcribe");
      expect(transcribe.sampleRate).toBe(16000);
      expect(transcribe.audio).toEqual(audio);
      expect(transcribe.requestId).toBe("test-456");
    });

    it("creates a Transcribe request with config", () => {
      const audio = new Float32Array([0.5]);
      const config = new ASRConfigPayload({ language: "es" });
      const transcribe = new Transcribe({
        requestId: "test-789",
        audio,
        sampleRate: 16000,
        config
      });
      expect(transcribe.config?.language).toBe("es");
    });
  });

  describe("Response schemas", () => {
    it("creates TranscribeResult with transcript", () => {
      const result = new TranscribeResult({
        _tag: "TranscribeResult",
        transcript: "Hello world"
      });
      expect(result._tag).toBe("TranscribeResult");
      expect(result.transcript).toBe("Hello world");
    });

    it("creates PreloadComplete with loaded status", () => {
      const complete = new PreloadComplete({
        _tag: "PreloadComplete",
        status: "loaded"
      });
      expect(complete._tag).toBe("PreloadComplete");
      expect(complete.status).toBe("loaded");
    });

    it("creates PreloadComplete with already_loaded status", () => {
      const complete = new PreloadComplete({
        _tag: "PreloadComplete",
        status: "already_loaded"
      });
      expect(complete.status).toBe("already_loaded");
    });
  });

  describe("PreloadProgress events", () => {
    it("creates progress event with initiate status", () => {
      const progress = new PreloadProgress({
        _tag: "PreloadProgress",
        status: "initiate",
        file: "model.bin"
      });
      expect(progress._tag).toBe("PreloadProgress");
      expect(progress.status).toBe("initiate");
      expect(progress.file).toBe("model.bin");
    });

    it("creates progress event with download progress", () => {
      const progress = new PreloadProgress({
        _tag: "PreloadProgress",
        status: "progress",
        file: "model.bin",
        progress: 0.5,
        loaded: 5000,
        total: 10000
      });
      expect(progress.status).toBe("progress");
      expect(progress.progress).toBe(0.5);
      expect(progress.loaded).toBe(5000);
      expect(progress.total).toBe(10000);
    });

    it("creates progress event with done status", () => {
      const progress = new PreloadProgress({
        _tag: "PreloadProgress",
        status: "done",
        file: "model.bin"
      });
      expect(progress.status).toBe("done");
    });

    it("creates progress event with ready status", () => {
      const progress = new PreloadProgress({
        _tag: "PreloadProgress",
        status: "ready"
      });
      expect(progress.status).toBe("ready");
    });
  });

  describe("ASRWorkerRequest union", () => {
    it("matches Preload requests", () => {
      const preload = new Preload({ requestId: "test-1", config: undefined });
      // The union type accepts both Preload and Transcribe
      const request: Schema.Schema.Type<typeof ASRWorkerRequest> = preload;
      expect(request._tag).toBe("Preload");
    });

    it("matches Transcribe requests", () => {
      const transcribe = new Transcribe({
        requestId: "test-2",
        audio: new Float32Array([0.1]),
        sampleRate: 16000,
        config: undefined
      });
      const request: Schema.Schema.Type<typeof ASRWorkerRequest> = transcribe;
      expect(request._tag).toBe("Transcribe");
    });
  });

  describe("PreloadEvent union", () => {
    it("matches PreloadProgress events", () => {
      const progress = new PreloadProgress({
        _tag: "PreloadProgress",
        status: "download"
      });
      const event: Schema.Schema.Type<typeof PreloadEvent> = progress;
      expect(event._tag).toBe("PreloadProgress");
    });

    it("matches PreloadComplete events", () => {
      const complete = new PreloadComplete({
        _tag: "PreloadComplete",
        status: "loaded"
      });
      const event: Schema.Schema.Type<typeof PreloadEvent> = complete;
      expect(event._tag).toBe("PreloadComplete");
    });
  });

  describe("Error schema", () => {
    it("TranscriptionFailed has correct structure", () => {
      const error = new TranscriptionFailed({ reason: "Model not loaded" });
      expect(error._tag).toBe("TranscriptionFailed");
      expect(error.reason).toBe("Model not loaded");
    });
  });

  describe("ASRConfigPayload", () => {
    it("creates config with all optional fields", () => {
      const config = new ASRConfigPayload({});
      expect(config.model).toBeUndefined();
      expect(config.language).toBeUndefined();
      expect(config.sampleRate).toBeUndefined();
    });

    it("creates config with partial fields", () => {
      const config = new ASRConfigPayload({
        model: "whisper-base",
        sampleRate: 16000
      });
      expect(config.model).toBe("whisper-base");
      expect(config.sampleRate).toBe(16000);
      expect(config.language).toBeUndefined();
    });
  });
});
