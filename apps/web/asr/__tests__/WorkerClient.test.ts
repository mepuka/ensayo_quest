/**
 * WorkerClient Tests
 *
 * Tests for the WorkerClient module including both legacy and new TaggedRequest protocol types.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 4
 */
import { it, expect, describe } from "bun:test";
import {
  // Legacy exports (Phase 0 backward compatibility)
  buildTranscribeRequest,
  TranscribeRequest,
  TranscribeResponse,
  PreloadRequest,
  PreloadProgress,
  PreloadResponse,
  decodeTranscribeRequest,
  encodeTranscribeRequest,
  decodeTranscribeResponse,
  encodeTranscribeResponse,
  decodePreloadRequest,
  decodeWorkerRequest,
  // New TaggedRequest protocol exports (Phase 1+)
  Preload,
  Transcribe,
  TranscribeResult,
  PreloadComplete,
  PreloadProgressEvent,
  PreloadEvent,
  ASRWorkerRequest
} from "../worker/WorkerClient";

describe("Legacy Protocol (Phase 0)", () => {
  describe("buildTranscribeRequest", () => {
    it("builds a transcribe request payload", () => {
      const request = buildTranscribeRequest(new Float32Array([0, 1]), 16000);
      expect(request.type).toBe("transcribe");
      expect(request.sampleRate).toBe(16000);
    });

    it("includes audio data in request", () => {
      const audio = new Float32Array([0.1, 0.2, 0.3]);
      const request = buildTranscribeRequest(audio, 16000);
      expect(request.audio).toEqual(audio);
    });
  });

  describe("TranscribeRequest schema", () => {
    it("creates a TranscribeRequest instance", () => {
      const request = new TranscribeRequest({
        type: "transcribe",
        audio: new Float32Array([0.5]),
        sampleRate: 16000
      });
      expect(request.type).toBe("transcribe");
      expect(request.sampleRate).toBe(16000);
    });

    it("encodes and decodes TranscribeRequest", () => {
      const original = new TranscribeRequest({
        type: "transcribe",
        audio: new Float32Array([0.1, 0.2]),
        sampleRate: 16000
      });
      const encoded = encodeTranscribeRequest(original);
      const decoded = decodeTranscribeRequest(encoded);
      expect(decoded.type).toBe("transcribe");
      expect(decoded.sampleRate).toBe(16000);
    });
  });

  describe("TranscribeResponse schema", () => {
    it("creates a TranscribeResponse instance", () => {
      const response = new TranscribeResponse({
        type: "result",
        transcript: "Hello world"
      });
      expect(response.type).toBe("result");
      expect(response.transcript).toBe("Hello world");
    });

    it("encodes and decodes TranscribeResponse", () => {
      const original = new TranscribeResponse({
        type: "result",
        transcript: "Test transcript"
      });
      const encoded = encodeTranscribeResponse(original);
      const decoded = decodeTranscribeResponse(encoded);
      expect(decoded.transcript).toBe("Test transcript");
    });
  });

  describe("PreloadRequest schema", () => {
    it("creates a PreloadRequest instance", () => {
      const request = new PreloadRequest({ type: "preload" });
      expect(request.type).toBe("preload");
    });

    it("decodes PreloadRequest", () => {
      const decoded = decodePreloadRequest({ type: "preload" });
      expect(decoded.type).toBe("preload");
    });
  });

  describe("PreloadProgress schema", () => {
    it("creates a progress event with all fields", () => {
      const progress = new PreloadProgress({
        type: "preload_progress",
        status: "progress",
        file: "model.bin",
        progress: 0.5,
        loaded: 5000,
        total: 10000
      });
      expect(progress.type).toBe("preload_progress");
      expect(progress.status).toBe("progress");
      expect(progress.progress).toBe(0.5);
    });

    it("creates a progress event with minimal fields", () => {
      const progress = new PreloadProgress({
        type: "preload_progress",
        status: "initiate"
      });
      expect(progress.status).toBe("initiate");
      expect(progress.file).toBeUndefined();
    });
  });

  describe("PreloadResponse schema", () => {
    it("creates a preload complete response", () => {
      const response = new PreloadResponse({
        type: "preload_complete",
        status: "loaded"
      });
      expect(response.type).toBe("preload_complete");
      expect(response.status).toBe("loaded");
    });

    it("handles already_loaded status", () => {
      const response = new PreloadResponse({
        type: "preload_complete",
        status: "already_loaded"
      });
      expect(response.status).toBe("already_loaded");
    });
  });

  describe("decodeWorkerRequest", () => {
    it("decodes transcribe request by type", () => {
      const decoded = decodeWorkerRequest({
        type: "transcribe",
        audio: new Float32Array([0.1]),
        sampleRate: 16000
      });
      expect(decoded.type).toBe("transcribe");
    });

    it("decodes preload request by type", () => {
      const decoded = decodeWorkerRequest({ type: "preload" });
      expect(decoded.type).toBe("preload");
    });
  });
});

describe("New TaggedRequest Protocol (Phase 1+)", () => {
  describe("Preload TaggedRequest", () => {
    it("creates a Preload request", () => {
      const preload = new Preload({ requestId: "test-123", config: undefined });
      expect(preload._tag).toBe("Preload");
      expect(preload.requestId).toBe("test-123");
    });
  });

  describe("Transcribe TaggedRequest", () => {
    it("creates a Transcribe request", () => {
      const transcribe = new Transcribe({
        requestId: "test-456",
        audio: new Float32Array([0.1, 0.2]),
        sampleRate: 16000,
        config: undefined
      });
      expect(transcribe._tag).toBe("Transcribe");
      expect(transcribe.requestId).toBe("test-456");
      expect(transcribe.sampleRate).toBe(16000);
    });
  });

  describe("TranscribeResult response", () => {
    it("creates a TranscribeResult", () => {
      const result = new TranscribeResult({
        _tag: "TranscribeResult",
        transcript: "Hola mundo"
      });
      expect(result._tag).toBe("TranscribeResult");
      expect(result.transcript).toBe("Hola mundo");
    });
  });

  describe("PreloadComplete response", () => {
    it("creates a PreloadComplete with loaded status", () => {
      const complete = new PreloadComplete({
        _tag: "PreloadComplete",
        status: "loaded"
      });
      expect(complete._tag).toBe("PreloadComplete");
      expect(complete.status).toBe("loaded");
    });
  });

  describe("PreloadProgressEvent", () => {
    it("creates a progress event", () => {
      const progress = new PreloadProgressEvent({
        _tag: "PreloadProgress",
        status: "download",
        file: "model.safetensors"
      });
      expect(progress._tag).toBe("PreloadProgress");
      expect(progress.status).toBe("download");
    });
  });

  describe("ASRWorkerRequest union", () => {
    it("accepts Preload requests", () => {
      const preload = new Preload({ requestId: "test", config: undefined });
      // TypeScript union type check
      const _request: typeof ASRWorkerRequest.Type = preload;
      expect(_request._tag).toBe("Preload");
    });

    it("accepts Transcribe requests", () => {
      const transcribe = new Transcribe({
        requestId: "test",
        audio: new Float32Array([]),
        sampleRate: 16000,
        config: undefined
      });
      const _request: typeof ASRWorkerRequest.Type = transcribe;
      expect(_request._tag).toBe("Transcribe");
    });
  });
});
