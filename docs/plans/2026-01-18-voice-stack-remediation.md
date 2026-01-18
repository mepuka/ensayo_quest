# Voice Stack Remediation Plan

## Summary

Code review identified 6 issues in the voice stack implementation. This plan addresses each finding with validated root causes and Effect-native remediation patterns (WorkerRunner streaming, Worker.execute usage, and Transferable-backed buffers).

## Validated Findings

### HIGH-1: Dual Runtime Worker Issue

**Status**: Confirmed

**Root Cause**: Two separate `Atom.runtime()` calls create independent worker instances:
- `recordingRuntime` (line 47) - used by `preloadModelFn`
- `vadRecordingRuntime` (line 129) - used by `startRecordingFn`/`stopRecordingFn`

**Impact**: Model preload warms a different worker than transcription uses. First real transcription pays cold-start cost.

**Fix**: Merge into single runtime with combined layer.

### HIGH-2: VAD Config Units Mismatch

**Status**: Confirmed

**Root Cause**:
- `VadServiceOptions` defines `redemptionFrames`, `preSpeechPadFrames`, `minSpeechFrames`
- vad-web MicVAD expects `redemptionMs`, `preSpeechPadMs`, `minSpeechMs`
- We convert ms→frames, then vad-web converts ms→frames again (double conversion)

**Impact**: VAD timing is ~96x shorter than intended (10 frames treated as 10ms instead of 1000ms).

**Fix**: Rename interface properties to `*Ms` and remove manual conversion.

### HIGH-3: Production Worker Build Missing

**Status**: Confirmed

**Root Cause**:
- `/asrWorker.js` and `/audioProcessor.js` built only in `dev.ts`
- Output to `.dev/` (gitignored), not `dist/`
- No production build script exists
- Cloudflare Pages config doesn't include worker assets

**Impact**: Production will 404 on worker assets, breaking voice features entirely.

**Decision Required**: Dev-only vs production deployment.

### MEDIUM-1: VoiceLab Render-Time State Update

**Status**: Confirmed

**Root Cause**: Lines 79-81 call `handleResultChange()` during render body, not in useEffect.

**Impact**: Potential render loops, React warnings.

**Fix**: Move to `useEffect`.

### MEDIUM-2: Preload Progress Not Surfaced

**Status**: Confirmed

**Root Cause**:
- `PreloadProgress` type defined but excluded from `AsrWorker` response union
- Worker logs progress to console instead of emitting
- `createWorkerClient.preload()` uses `executeEffect()` (single value) not `execute()` (stream)
- `modelLoadingAtom.downloadProgress` never updated

**Impact**: UI shows status transitions but no download percentage.

**Decision Required**: Status-only acceptable or implement streaming progress?

### LOW-1: Worklet Buffer Reuse

**Status**: Confirmed

**Root Cause**: `audioProcessor.ts` line 19 posts `channel` directly without copying:
```typescript
this.port.postMessage(channel);  // Buffer reused by AudioWorklet
```

**Impact**: Corrupted audio if WorkletCapture is ever used (currently VAD-only path doesn't use it).

**Fix**: `this.port.postMessage(channel.slice())` or remove worklet if VAD-only.

---

## Effect Source Notes (Remediation Guidance)

- `WorkerRunner.layer` accepts handlers that return either an `Effect` or a `Stream`. For preload progress, return a `Stream` and use `Stream.fromEffect(...)` for single-response handlers to keep a unified worker protocol. (`effect/packages/platform/src/WorkerRunner.ts`)
- `Worker.execute` returns a `Stream` and is the correct API for progress streams. `Worker.executeEffect` should only be used for single responses. (`effect/packages/platform/src/Worker.ts`)
- Transferables are collected via `Transferable.Collector` when encode functions are used. Prefer `Transferable.schema(...)` on `Float32Array` request fields to transfer audio buffers without copies. (`effect/packages/platform/src/Transferable.ts`)

## Implementation Plan

### Phase 1: Critical Fixes (Runtime + VAD Config)

**Goal**: Fix worker reuse and VAD timing - core functionality.

#### Task 1.1: Merge Runtimes

**File**: `apps/web/atoms/recording.ops.ts`

```typescript
// BEFORE: Two runtimes
const recordingLayer = LocalAsrLive.pipe(
  Layer.provide(Layer.mergeAll(browserWorkerLayer, WorkletCaptureLive))
);
const recordingRuntime = Atom.runtime(recordingLayer);

const vadConfigLayer = VadServiceConfigured({...});
const vadRecordingLayer = Layer.mergeAll(vadConfigLayer, LocalAsrLive.pipe(...));
const vadRecordingRuntime = Atom.runtime(vadRecordingLayer);

// AFTER: Single runtime with all layers
const recordingLayer = Layer.mergeAll(
  VadServiceConfigured({
    baseAssetPath: "/vad",
    onnxWASMBasePath: "/vad/onnx",
    model: "legacy",
    positiveSpeechThreshold: vadConfig.positiveSpeechThreshold,
    redemptionMs: vadConfig.redemptionMs,
    minSpeechMs: vadConfig.minSpeechMs,
    submitUserSpeechOnPause: true
  }),
  LocalAsrLive.pipe(
    Layer.provide(Layer.mergeAll(browserWorkerLayer, WorkletCaptureLive))
  )
);

const recordingRuntime = Atom.runtime(recordingLayer);

// All operations use same runtime
export const preloadModelFn = recordingRuntime.fn<void>()(/*...*/);
export const startRecordingFn = recordingRuntime.fn<void>()(/*...*/);
export const stopRecordingFn = recordingRuntime.fn<void>()(/*...*/);
```

**Rationale**: `Layer.scoped` in `LocalAsrLive` ensures worker is created once per runtime scope. If you ever need multiple runtimes, use `Layer.memoize` to share the worker across them, but single-runtime is preferred.

#### Task 1.2: Fix VAD Config Units

**File**: `apps/web/asr/VadService.ts`

```typescript
// BEFORE (lines 81-98)
readonly redemptionFrames?: number;
readonly preSpeechPadFrames?: number;
readonly minSpeechFrames?: number;

// AFTER
readonly redemptionMs?: number;
readonly preSpeechPadMs?: number;
readonly minSpeechMs?: number;
```

**File**: `apps/web/asr/VadService.ts` (MicVAD.new call, ~line 185)

```typescript
// BEFORE
redemptionFrames: config.redemptionFrames ?? 8,
preSpeechPadFrames: config.preSpeechPadFrames ?? 1,
minSpeechFrames: config.minSpeechFrames ?? 3,

// AFTER
redemptionMs: config.redemptionMs ?? 500,
preSpeechPadMs: config.preSpeechPadMs ?? 500,
minSpeechMs: config.minSpeechMs ?? 250,
```

**File**: `apps/web/atoms/recording.ops.ts` (vadConfigLayer)

```typescript
// BEFORE
redemptionFrames: Math.floor(vadConfig.redemptionMs / 96),
minSpeechFrames: Math.floor(vadConfig.minSpeechMs / 96),

// AFTER (no conversion needed)
redemptionMs: vadConfig.redemptionMs,  // 1000
minSpeechMs: vadConfig.minSpeechMs,    // 500
```

### Phase 2: React Fix (VoiceLab)

**Goal**: Fix render-time state update.

**File**: `apps/web/components/dev/VoiceLab.tsx`

```typescript
// BEFORE (lines 79-81 in render body)
if (asrResult && transcriptLog[transcriptLog.length - 1]?.id !== asrResult.requestId) {
  handleResultChange();
}

// AFTER (useEffect with functional update; no transcriptLog dependency)
useEffect(() => {
  if (!asrResult || !asrResult.transcript) return;
  setTranscriptLog((prev) => {
    if (prev[prev.length - 1]?.id === asrResult.requestId) {
      return prev;
    }
    return [
      ...prev,
      {
        id: asrResult.requestId,
        transcript: asrResult.transcript,
        durationMs: asrResult.durationMs,
        timestamp: Date.now()
      }
    ];
  });
}, [asrResult]);

// Remove handleResultChange callback (inline in useEffect)
```

### Phase 3: Worklet Buffer Fix (Defensive)

**Goal**: Fix potential audio corruption if worklet path ever used.

**File**: `apps/web/asr/worklet/audioProcessor.ts`

```typescript
// BEFORE (line 19)
this.port.postMessage(channel);

// AFTER
this.port.postMessage(channel.slice());
```

### Phase 4: Production Decision (Blocking)

**Decision Required**: Is voice stack intended for production now?

#### Option A: Dev-Only (Recommended for now)

Gate preload and recording in production:

**File**: `apps/web/components/App.tsx`

```typescript
useEffect(() => {
  // Only preload in development
  if (!hasPreloadedRef.current && import.meta.env.DEV) {
    hasPreloadedRef.current = true;
    preload();
  }
}, [preload]);
```

**Rationale**: Voice Lab already dev-gated; consistent approach until prod build added.

#### Option B: Add Production Build

**Important**: `vite build` clears `dist` by default, so building workers directly into `dist` before Vite will be wiped.

**Option B1 (Vite-friendly, recommended)**: Build into `apps/web/public/workers` so Vite copies assets into `dist`.

Create `apps/web/scripts/build-workers.ts`:

```typescript
import { join } from "node:path";
import { resolveAsrShimPath } from "../asr/worker/workerBuild";

const PUBLIC_WORKERS = join(import.meta.dirname, "../public/workers");

const builtinShims = {
  fs: resolveAsrShimPath("fs"),
  path: resolveAsrShimPath("path"),
  url: resolveAsrShimPath("url")
};

await Bun.build({
  entrypoints: ["./apps/web/asr/worker/asrWorker.ts"],
  outdir: PUBLIC_WORKERS,
  target: "browser",
  plugins: [/* same shim plugin as dev.ts */]
});

await Bun.build({
  entrypoints: ["./apps/web/asr/worklet/audioProcessor.ts"],
  outdir: PUBLIC_WORKERS,
  target: "browser"
});

console.log("Workers built to public/workers/");
```

Update worker URLs to `/workers/asrWorker.js` and `/workers/audioProcessor.js` so both dev and prod can serve the same assets.

Add to package.json:
```json
"build:workers": "bun run apps/web/scripts/build-workers.ts",
"build": "bun run build:workers && vite build"
```

**Option B2 (Vite worker bundling)**: Use Vite’s worker pipeline and `new Worker(new URL("./asr/worker/asrWorker.ts", import.meta.url), { type: "module" })`, then remove static URL construction. This avoids manual asset management but requires adjusting the Effect worker spawner.

### Phase 5: Progress Streaming (Optional Enhancement)

**Decision Required**: Status-only acceptable or implement streaming?

If streaming desired:

#### Task 5.1: Update Worker Types

**File**: `apps/web/asr/worker/WorkerClient.ts`

```typescript
export type AsrWorkerMessage =
  | TranscribeResponse
  | PreloadResponse
  | PreloadProgress;

export type AsrWorker = Worker.Worker<
  WorkerRequest,
  AsrWorkerMessage,
  TranscriptionFailed
>;
```

#### Task 5.2: Add Streaming Preload + LocalAsr API

**File**: `apps/web/asr/worker/WorkerClient.ts`

```typescript
const preloadWithProgress = () =>
  worker.execute(new PreloadRequest({ type: "preload" })).pipe(
    Stream.filter((msg): msg is PreloadProgress | PreloadResponse =>
      msg.type === "preload_progress" || msg.type === "preload_complete"
    )
  );

return { transcribe, preload, preloadWithProgress };
```

**File**: `apps/web/asr/LocalAsr.ts`

```typescript
// Service contract adds preloadWithProgress()
preloadWithProgress: () => Stream.Stream<PreloadProgress | PreloadResponse, Error, never>;
```

#### Task 5.3: Update Worker Handler (Stream-based)

**File**: `apps/web/asr/worker/asrWorker.ts`

```typescript
const preloadStream = (_request: PreloadRequest) =>
  Stream.asyncPush<PreloadProgress | PreloadResponse>((emit) =>
    Effect.gen(function* () {
      const wasAlreadyLoaded = transcriber !== null;
      yield* Effect.addFinalizer(() => Effect.sync(() => emit.end()));

      yield* ensureTranscriber((progress) => {
        emit.single(progress);
      });

      emit.single(new PreloadResponse({
        type: "preload_complete",
        status: wasAlreadyLoaded ? "already_loaded" : "loaded"
      }));
      emit.end();
    })
  );

const handleRequest = (request: WorkerRequest) =>
  request.type === "preload"
    ? preloadStream(request)
    : Stream.fromEffect(transcribe(request));
```

#### Task 5.4: Consume in Preload Operation

**File**: `apps/web/atoms/recording.ops.ts`

```typescript
export const preloadModelFn = recordingRuntime.fn<void>()(
  Effect.fnUntraced(function* () {
    const localAsr = yield* LocalAsr;

    yield* Atom.set(modelLoadingAtom, { status: "checking_cache" });

    yield* Stream.runForEach(
      localAsr.preloadWithProgress(),
      (event) => Effect.gen(function* () {
        if (event.type === "preload_progress") {
          if (event.status === "download" && event.progress !== undefined) {
            yield* Atom.set(modelLoadingAtom, {
              status: "downloading",
              downloadProgress: event.progress
            });
          }
        } else if (event.type === "preload_complete") {
          yield* Atom.set(modelLoadingAtom, { status: "ready" });
        }
      })
    );
  })
);
```

#### Task 5.5: Transferable Audio Buffers (Optional)

**File**: `apps/web/asr/worker/WorkerClient.ts`

```typescript
const Float32ArrayTransfer = Transferable.schema(
  Float32ArraySchema,
  (value) => [value.buffer]
);
```

Use `Float32ArrayTransfer` in the request schema so audio buffers transfer without copies.

---

## Verification Checklist

- [ ] Single runtime: `preloadModelFn`, `startRecordingFn`, `stopRecordingFn` all use same worker
- [ ] VAD timing: redemptionMs=1000 results in ~1 second pause tolerance
- [ ] VoiceLab: No React warnings about render-time state updates
- [ ] Worklet: `channel.slice()` creates copy before postMessage
- [ ] Dev server: `bun run apps/web/dev.ts` bundles without errors
- [ ] Tests: `bun test apps/web/asr` passes

## Questions for User

1. **Production readiness**: Gate voice features in prod (Option A) or add production build (Option B)?
2. **Progress streaming**: Implement full download progress UI or status-only acceptable for MVP?
3. **Worklet removal**: Fully commit to VAD-only and delete WorkletCapture, or keep as fallback?

---

## Change Summary

| Finding | Severity | Fix Complexity | Phase |
|---------|----------|----------------|-------|
| Dual runtime | High | Medium | 1 |
| VAD config units | High | Low | 1 |
| Production build | High | Decision | 4 |
| VoiceLab render | Medium | Low | 2 |
| Progress streaming | Medium | High | 5 (optional) |
| Worklet buffer | Low | Trivial | 3 |
