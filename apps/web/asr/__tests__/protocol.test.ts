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

/**
 * Decode/Encode Failure Tests
 *
 * Tests that verify schema decode rejects invalid/malformed data.
 * Required by Phase 4 spec: ensure decode failures produce structured errors.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 4
 */
describe("Protocol decode failures", () => {
  describe("Preload decode failures", () => {
    it("rejects Preload with missing requestId", () => {
      const decode = Schema.decodeUnknownSync(Preload);
      expect(() => decode({ _tag: "Preload" })).toThrow();
    });

    it("rejects Preload with wrong _tag", () => {
      const decode = Schema.decodeUnknownSync(Preload);
      expect(() => decode({ _tag: "Wrong", requestId: "test" })).toThrow();
    });

    it("rejects Preload with invalid requestId type", () => {
      const decode = Schema.decodeUnknownSync(Preload);
      expect(() => decode({ _tag: "Preload", requestId: 123 })).toThrow();
    });

    it("rejects Preload with invalid config type", () => {
      const decode = Schema.decodeUnknownSync(Preload);
      expect(() =>
        decode({
          _tag: "Preload",
          requestId: "test",
          config: "not-an-object"
        })
      ).toThrow();
    });
  });

  describe("Transcribe decode failures", () => {
    it("rejects Transcribe with missing requestId", () => {
      const decode = Schema.decodeUnknownSync(Transcribe);
      expect(() =>
        decode({
          _tag: "Transcribe",
          audio: new Float32Array([0.1]),
          sampleRate: 16000
        })
      ).toThrow();
    });

    it("rejects Transcribe with invalid audio type", () => {
      const decode = Schema.decodeUnknownSync(Transcribe);
      expect(() =>
        decode({
          _tag: "Transcribe",
          requestId: "test",
          audio: "not-a-float32array",
          sampleRate: 16000
        })
      ).toThrow();
    });

    it("rejects Transcribe with invalid sampleRate type", () => {
      const decode = Schema.decodeUnknownSync(Transcribe);
      expect(() =>
        decode({
          _tag: "Transcribe",
          requestId: "test",
          audio: new Float32Array([0.1]),
          sampleRate: "not-a-number"
        })
      ).toThrow();
    });

    it("rejects Transcribe with missing sampleRate", () => {
      const decode = Schema.decodeUnknownSync(Transcribe);
      expect(() =>
        decode({
          _tag: "Transcribe",
          requestId: "test",
          audio: new Float32Array([0.1])
        })
      ).toThrow();
    });
  });

  describe("ASRWorkerRequest union decode failures", () => {
    it("rejects unknown _tag in request union", () => {
      const decode = Schema.decodeUnknownSync(ASRWorkerRequest);
      expect(() => decode({ _tag: "Unknown", requestId: "test" })).toThrow();
    });

    it("rejects empty object", () => {
      const decode = Schema.decodeUnknownSync(ASRWorkerRequest);
      expect(() => decode({})).toThrow();
    });

    it("rejects null", () => {
      const decode = Schema.decodeUnknownSync(ASRWorkerRequest);
      expect(() => decode(null)).toThrow();
    });

    it("rejects primitive values", () => {
      const decode = Schema.decodeUnknownSync(ASRWorkerRequest);
      expect(() => decode("string")).toThrow();
      expect(() => decode(123)).toThrow();
      expect(() => decode(true)).toThrow();
    });
  });

  describe("Response schema decode failures", () => {
    it("rejects TranscribeResult with missing transcript", () => {
      const decode = Schema.decodeUnknownSync(TranscribeResult);
      expect(() => decode({ _tag: "TranscribeResult" })).toThrow();
    });

    it("rejects TranscribeResult with invalid transcript type", () => {
      const decode = Schema.decodeUnknownSync(TranscribeResult);
      expect(() =>
        decode({ _tag: "TranscribeResult", transcript: 123 })
      ).toThrow();
    });

    it("rejects PreloadComplete with missing status", () => {
      const decode = Schema.decodeUnknownSync(PreloadComplete);
      expect(() => decode({ _tag: "PreloadComplete" })).toThrow();
    });

    it("rejects PreloadComplete with invalid status value", () => {
      const decode = Schema.decodeUnknownSync(PreloadComplete);
      expect(() =>
        decode({ _tag: "PreloadComplete", status: "invalid" })
      ).toThrow();
    });

    it("rejects PreloadProgress with invalid status value", () => {
      const decode = Schema.decodeUnknownSync(PreloadProgress);
      expect(() =>
        decode({ _tag: "PreloadProgress", status: "invalid_status" })
      ).toThrow();
    });
  });

  describe("PreloadEvent union decode failures", () => {
    it("rejects unknown event type in PreloadEvent union", () => {
      const decode = Schema.decodeUnknownSync(PreloadEvent);
      expect(() =>
        decode({ _tag: "UnknownEvent", status: "test" })
      ).toThrow();
    });

    it("rejects PreloadEvent with malformed PreloadProgress", () => {
      const decode = Schema.decodeUnknownSync(PreloadEvent);
      expect(() =>
        decode({ _tag: "PreloadProgress" }) // missing required status
      ).toThrow();
    });
  });
});

/**
 * Concurrent Request Support Tests
 *
 * Tests that verify the protocol supports concurrent requests correctly.
 * The actual single-flight behavior is in the worker; these tests verify
 * the protocol layer accepts concurrent requests without error.
 *
 * @see docs/plans/2026-01-20-asr-worker-effect-hardening.md - Phase 4
 */
describe("Concurrent request support", () => {
  it("protocol allows multiple concurrent Preload requests with unique requestIds", () => {
    const preload1 = new Preload({ requestId: "req-1", config: undefined });
    const preload2 = new Preload({ requestId: "req-2", config: undefined });
    const preload3 = new Preload({ requestId: "req-3", config: undefined });

    expect(preload1.requestId).toBe("req-1");
    expect(preload2.requestId).toBe("req-2");
    expect(preload3.requestId).toBe("req-3");

    // All are valid Preload instances
    expect(preload1._tag).toBe("Preload");
    expect(preload2._tag).toBe("Preload");
    expect(preload3._tag).toBe("Preload");
  });

  it("protocol allows multiple concurrent Transcribe requests with unique requestIds", () => {
    const audio = new Float32Array([0.1, 0.2, 0.3]);
    const transcribe1 = new Transcribe({
      requestId: "tx-1",
      audio,
      sampleRate: 16000,
      config: undefined
    });
    const transcribe2 = new Transcribe({
      requestId: "tx-2",
      audio,
      sampleRate: 16000,
      config: undefined
    });

    expect(transcribe1.requestId).toBe("tx-1");
    expect(transcribe2.requestId).toBe("tx-2");
    expect(transcribe1._tag).toBe("Transcribe");
    expect(transcribe2._tag).toBe("Transcribe");
  });

  it("requestId enables correlation of concurrent requests", () => {
    // Simulate multiple concurrent requests with UUIDs
    const requests = Array.from({ length: 5 }, (_, i) => ({
      preload: new Preload({
        requestId: `preload-${i}`,
        config: undefined
      }),
      transcribe: new Transcribe({
        requestId: `transcribe-${i}`,
        audio: new Float32Array([0.1]),
        sampleRate: 16000,
        config: undefined
      })
    }));

    // All requestIds should be unique
    const allRequestIds = requests.flatMap((r) => [
      r.preload.requestId,
      r.transcribe.requestId
    ]);
    const uniqueRequestIds = new Set(allRequestIds);
    expect(uniqueRequestIds.size).toBe(10);
  });
});
