# ASR Worker Effect Hardening Plan and Production Spec

Status: Draft (engineering plan + production spec)
Owner: TBD
Related: docs/ARCHITECTURE.md, docs/plans/2026-01-18-voice-stack-remediation.md

## Goal
Harden the browser ASR worker pipeline end-to-end using idiomatic Effect patterns, including serialized worker protocols, safe encoding/decoding, single-flight model loading, progress streaming, and robust client integration.

## Non-Goals
- Change scoring, EventLog, or room flow behavior (backend invariants remain untouched).
- Replace the ASR model or the HuggingFace Transformers runtime.
- Redesign UI flows beyond what is required to display ASR progress and results.

## Current State and Gaps (Observed)
- WorkerRunner `decode`/`encode` are wrapped with `Effect.succeed` but call `Schema.decodeUnknownSync`/`Schema.encodeSync`, which can throw synchronously and bypass WorkerRunner error handling. `apps/web/asr/worker/asrWorker.ts:112` and `apps/web/asr/worker/asrWorker.ts:119` + `apps/web/asr/worker/WorkerClient.ts:79`.
- Global `transcriber` has no in-flight guard, so concurrent `preload` and `transcribe` can trigger duplicate loads and inconsistent `wasAlreadyLoaded` status. `apps/web/asr/worker/asrWorker.ts:31`.
- Preload progress is logged in the worker but not surfaced to the client, even though `PreloadProgress` exists. `apps/web/asr/worker/asrWorker.ts:87` and `apps/web/asr/worker/WorkerClient.ts:39`.
- LocalAsr always transcribes on stop, even when audio is empty, and coerces all errors to `Error`, losing typed error detail. `apps/web/asr/LocalAsr.ts:98`.
- Recording ops accept any result order and swallow transcription errors, risking stale results and poor observability. `apps/web/atoms/recording.ops.ts:197`.

## Effect Source References (Design Anchors)
These are the canonical Effect behaviors used by the refactor:
- WorkerRunner supports `Stream` or `Effect` handlers; encode/decode are typed effects. `effect/packages/platform/src/WorkerRunner.ts:124`, `effect/packages/platform/src/internal/workerRunner.ts:65`.
- Serialized worker protocol with schema-based encode/decode and failure propagation. `effect/packages/platform/src/WorkerRunner.ts:213`, `effect/packages/platform/src/internal/workerRunner.ts:150`.
- Worker interface for streaming vs single response. `effect/packages/platform/src/Worker.ts:91`.
- Serialized worker result types include parse errors. `effect/packages/platform/src/Worker.ts:258`.
- Worker `encode` can participate in transferables; collector usage is handled in the platform worker. `effect/packages/platform/src/Worker.ts:128`, `effect/packages/platform/src/internal/worker.ts:66`.
- Transferable schema helper for buffer transfers. `effect/packages/platform/src/Transferable.ts:82`.
- `Schema.TaggedRequest` for request/response types. `effect/packages/effect/src/Schema.ts:10631`.
- `Effect.cached` and TTL variants for single-flight caching of expensive effects. `effect/packages/effect/src/Effect.ts:351`.
- `Deferred` for single-assignment coordination and awaiters. `effect/packages/effect/src/Deferred.ts:28`.
- Browser WorkerRunner layer for runtime binding. `effect/packages/platform-browser/src/BrowserWorkerRunner.ts:20`.

## Production Spec (Target Design)

### 1) ASR Worker Protocol (Serialized)
Define worker messages using `Schema.TaggedRequest` so requests and responses are encoded/decoded by Effect’s serialized runner:
- `Preload`: payload includes `requestId` and optional `config` (model, language, sampleRate).
- `Transcribe`: payload includes `requestId`, `audio`, `sampleRate`, optional `config`.
- `PreloadProgress` and `PreloadComplete` become streamed outputs for `Preload`, not just console logs.

Why: `TaggedRequest` and `WorkerRunner.layerSerialized` provide typed encode/decode, parsed errors, and consistent error handling. `effect/packages/effect/src/Schema.ts:10631`, `effect/packages/platform/src/WorkerRunner.ts:213`, `effect/packages/platform/src/internal/workerRunner.ts:150`.

### 2) Worker Runtime (Serialized Runner)
Use `WorkerRunner.layerSerialized` to implement the worker handler:
- `Preload` handler returns `Stream<PreloadProgress | PreloadComplete>` so the client can display progress.
- `Transcribe` handler returns `Effect<TranscribeResponse>` for a single response.
- Errors are encoded via the serialized runner; no manual `encodeError` wrappers with sync throw risks.

References: `effect/packages/platform/src/WorkerRunner.ts:124`, `effect/packages/platform/src/internal/workerRunner.ts:65`, `effect/packages/platform/src/internal/workerRunner.ts:184`.

### 3) Model Load Lifecycle (Deferred + Cached)
Implement a single-flight model loader:
- Maintain a `Ref` with state: `Idle | Loading(Deferred) | Ready(Transcriber) | Failed(error)`.
- `ensureTranscriber` uses `Deferred` so concurrent preload/transcribe calls await the same in-flight load.
- Wrap the load effect with `Effect.cached` (optionally TTL) to avoid repeated pipeline creation.

References: `effect/packages/effect/src/Deferred.ts:28`, `effect/packages/effect/src/Effect.ts:351`.

### 4) Progress Streaming
Drive `PreloadProgress` from Transformers progress callbacks into a `Stream`:
- Use `Stream` in the worker handler to emit progress events followed by a final `PreloadComplete`.
- Use `worker.execute` on the client to consume streamed progress events.

References: `effect/packages/platform/src/Worker.ts:91`, `effect/packages/platform/src/internal/workerRunner.ts:71`.

### 5) Transferable Audio Buffers
Attach transferables when sending audio to the worker:
- Use `Transferable.schema` with a `Schema` for `Float32Array` to transfer the underlying buffer.
- Ensure worker encode uses the collector mechanism to pass transferables.

References: `effect/packages/platform/src/Transferable.ts:82`, `effect/packages/platform/src/internal/worker.ts:66`.

### 6) Error Model and Ordering
Preserve typed errors to UI boundaries:
- Convert `TranscriptionFailed` to a typed failure in the serialized protocol.
- Bubble `ParseError` from serialized worker back to the caller for diagnostics.
- Include `requestId` in responses; drop results that do not match the latest active request in recording ops.

References: `effect/packages/platform/src/Worker.ts:258`, `effect/packages/platform/src/internal/workerRunner.ts:190`.

### 7) Observability and Trace Propagation
Add spans and timing around preload/transcribe:
- Use `Effect.withSpan` around `Preload` and `Transcribe`.
- Worker runtime already propagates spans from the caller; maintain that via serialized worker. `effect/packages/platform/src/internal/worker.ts:154`.

### 8) Compatibility and Config
Keep compatibility with current `ASRConfig` and `ASRResult` shapes:
- Extend `ASRConfig` only if needed for protocol (model, language, sampleRate). `apps/web/asr/types.ts:11`.
- Ensure `LocalAsr` still provides `preload` and `transcribe` functions with compatible return shapes. `apps/web/asr/LocalAsr.ts:20`.

## Phased Implementation Plan

### Phase 0 - Protocol and Schema Freeze
Changes:
- Create a new protocol module (e.g., `apps/web/asr/worker/protocol.ts`) defining TaggedRequest classes for `Preload`, `Transcribe`, and their outputs.
- Add `requestId` and optional `config` fields to the request payloads; keep response compatibility.
- Add `Transferable`-aware schema for audio payloads.

References:
- `Schema.TaggedRequest` API. `effect/packages/effect/src/Schema.ts:10631`
- Transferable schema helper. `effect/packages/platform/src/Transferable.ts:82`
- Existing request/response shapes. `apps/web/asr/worker/WorkerClient.ts:14`

Acceptance:
- Protocol module compiles and is imported by both worker and client.
- Existing external API surfaces remain backward compatible (no UI behavior changes yet).

### Phase 1 - Worker Runtime Migration + Model Lifecycle
Changes:
- Switch `apps/web/asr/worker/asrWorker.ts` to `WorkerRunner.layerSerialized` with handlers for `Preload` (Stream) and `Transcribe` (Effect).
- Implement `ensureTranscriber` using `Ref + Deferred`, optionally wrapped by `Effect.cached` to enforce single-flight behavior.
- Remove manual `encodeOutput` and `encodeError` to avoid sync throw paths.

References:
- WorkerRunner serialized layer. `effect/packages/platform/src/WorkerRunner.ts:231`
- Serialized encode/decode handling. `effect/packages/platform/src/internal/workerRunner.ts:184`
- Deferred and cached for single-flight. `effect/packages/effect/src/Deferred.ts:28`, `effect/packages/effect/src/Effect.ts:351`
- Current worker implementation. `apps/web/asr/worker/asrWorker.ts:31`

Acceptance:
- Concurrent preload/transcribe results in a single model load.
- Any invalid message yields a structured error rather than crashing the worker.

### Phase 2 - Client Integration + Progress Streaming
Changes:
- Update `LocalAsr` to use serialized worker client APIs; wire `preload` to consume a Stream of progress events via `worker.execute`.
- Update `preloadModelFn` to reflect actual progress (not just optimistic state flips).
- Use `Transferable` schema for audio in worker requests.

References:
- `execute` vs `executeEffect`. `effect/packages/platform/src/Worker.ts:91`
- Worker encode + transferables. `effect/packages/platform/src/Worker.ts:128`, `effect/packages/platform/src/internal/worker.ts:66`
- Current LocalAsr usage. `apps/web/asr/LocalAsr.ts:64`

Acceptance:
- UI reflects real preload progress with multiple progress events.
- No regressions in existing preload or transcribe call sites.

### Phase 3 - Recording Ops Guardrails
Changes:
- In `apps/web/atoms/recording.ops.ts`, drop stale results by matching `requestId`.
- Skip transcription for empty audio buffers or zero sample rates.
- Preserve error types and surface them to the UI (instead of coercing to `Error`).

References:
- Existing recording flow. `apps/web/atoms/recording.ops.ts:162`
- Current LocalAsr error coercion. `apps/web/asr/LocalAsr.ts:98`

Acceptance:
- Stale results never overwrite newer ASR results.
- Empty audio does not call the worker.

### Phase 4 - Tests, Reliability, and Docs
Changes:
- Add tests for: decode/encode failures, concurrent preload, progress streaming, empty audio, and interruption handling.
- Update existing tests in `apps/web/asr/__tests__` to use serialized protocol types.
- Document new protocol and phase outputs in this plan.

References:
- Serialized worker failure surface. `effect/packages/platform/src/Worker.ts:258`
- WorkerRunner error propagation. `effect/packages/platform/src/internal/workerRunner.ts:114`

Acceptance:
- Tests pass; progress streaming and single-flight load behavior are covered.

**Phase 4 Completion Notes (2026-01-18):**
- Created `apps/web/asr/__tests__/protocol.test.ts` with comprehensive schema tests for TaggedRequest types (Preload, Transcribe, responses, unions).
- Updated `apps/web/asr/__tests__/LocalAsr.test.ts` to work with `makeSerialized` API using mock SerializedWorker that handles both `execute` (Stream) and `executeEffect` (Effect) methods.
- Updated `apps/web/asr/__tests__/WorkerClient.test.ts` to test both legacy (Phase 0) and new TaggedRequest (Phase 1+) protocol types.
- Created `apps/web/atoms/__tests__/recording.ops.test.ts` with tests for empty audio guard and requestId staleness behaviors from Phase 3.
- All 80 tests pass across ASR and atoms test suites.

## Phase Alignment Gates (Implementation Instructions)
To maintain alignment between phases during implementation:
1. Do not start Phase 1 until Phase 0 protocol types compile in both worker and client.
2. Do not start Phase 2 until Phase 1 passes a manual preload/transcribe test with single-flight loading.
3. Do not start Phase 3 until Phase 2 delivers progress events to the UI and all worker messages are serialized.
4. Do not start Phase 4 until Phase 3 includes request ordering and empty audio guards.
5. After each phase, update this document with a short completion note and any deviations.

## Definition of Done
- Worker messages are fully serialized (no manual encode/decode in `asrWorker.ts`).
- Preload emits progress to UI and loads the model exactly once per worker lifecycle.
- Transcribe is safe for empty inputs and returns results in requestId order.
- Tests cover concurrency, progress, parse errors, and error propagation.

## Risk and Rollout Notes
- Low risk: changes are isolated to frontend worker boundaries.
- Rollout: deploy behind a feature flag if needed; preserve existing UI surfaces. 
