# Frontend Voice Stack Design

**Date**: 2026-01-16
**Issue**: ensayo_quest-k7e (Research frontend stack for voice/audio pipeline)
**Status**: Design Review - Iteration 6 (CI/CD added)
**Last Updated**: 2026-01-16

---

## Executive Summary

This document compiles research findings from multiple parallel investigations into modernizing Ensayo Quest's frontend voice/audio pipeline. The recommendation is a **hybrid architecture** with:

1. **Client-side ASR**: Whisper via Transformers.js (current approach, validated)
2. **Frontend Framework**: TanStack Start for type-safe routing and server functions
3. **Voice Activity Detection**: Effect-native wrapper around @ricky0123/vad-web using **VAD-only pattern** (MicVAD owns capture)
4. **Audio Upload**: Required - R2 storage enables advanced scoring via audio understanding models (Gemini)
5. **Effect Integration**: Custom Effect wrappers using `Stream.asyncScoped` + `Layer.scoped` patterns
6. **EventLog Integration**: AudioUploaded event gates scoring pipeline (addresses race condition)

### Critical Architecture Decision

**Scoring Pipeline Race Condition Fix**: The current flow enqueues scoring on turn creation, but audio upload happens asynchronously after. This creates a race where the queue consumer may attempt to fetch audio from R2 before it exists. The fix is to:
1. Add `AudioUploaded` event to the EventLog
2. Gate audio-based scoring on this event
3. Implement idempotency for audio upload requests

---

## 1. Vercel AI SDK Voice Features

### Key Findings

- AI SDK 6 provides experimental `transcribe()` and `generateSpeech()` functions
- Unified provider interface: OpenAI, ElevenLabs, Deepgram, Hume
- **Not true streaming** - waits for completion, adds latency
- AI Elements provides React voice UI components (SpeechInput, VoiceSelector, Persona)

### Recommendation

**Do not adopt AI SDK for core ASR** - our current Transformers.js approach provides:
- Lower latency (no network round-trip)
- Better privacy (audio stays local)
- Offline capability

Consider AI SDK for optional features:
- Text-to-speech for pronunciation examples
- Cloud-based re-transcription for QA

### Code Pattern

```typescript
// If using AI SDK for TTS (optional)
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { openai } from '@ai-sdk/openai';

const { audio } = await generateSpeech({
  model: openai.speech('tts-1'),
  text: 'Example pronunciation',
  voice: 'nova'
});
```

---

## 2. TanStack Start + Effect Integration

### Key Findings

- **Status**: Release Candidate, feature-complete, preparing for 1.0
- **Migration**: Recently moved from Vinxi to Vite (v1.121.0+)
- 100% type-safe routing with TanStack Router
- Server Functions wrap Effect computations naturally
- `@effect-atom/atom-react` (already in use) works with TanStack Start

### Architecture Benefits

| Aspect | Current (Bun.serve) | TanStack Start |
|--------|---------------------|----------------|
| Routing | Manual | Type-safe, 100% inference |
| SSR | None | Selective per-route |
| Server Functions | Manual fetch | Type-safe RPC |
| DX | Custom | Framework conventions |

### Migration Path

1. Service layers stay in shared code
2. Convert API handlers to server functions
3. React components mostly unchanged
4. Cloudflare deployment via `@cloudflare/vite-plugin`

### Recommendation

**Consider for Phase 2** - Current Bun.serve setup works. Migration adds type-safe routing benefits but requires:
- Testing Durable Objects compatibility
- Queue handler verification
- Build pipeline updates

---

## 3. Transformers.js for Browser ASR

### Key Findings

- **Package**: Migrate from `@xenova/transformers` to `@huggingface/transformers` v3
- **Recommended Model**: `whisper-base` (74MB, current choice validated)
- **Backend**: WASM often faster than WebGPU on Apple Silicon
- **Limitation**: No true streaming - batch processing only

### Performance Expectations

| Platform | Backend | Time (30s audio) |
|----------|---------|------------------|
| M2 Mac | WASM | ~5-6 seconds |
| M2 Mac | WebGPU | ~9-10 seconds |
| Modern Intel/AMD | WebGPU | ~3-5 seconds |

### Accuracy Considerations

- Moderate accuracy on non-native accents
- Higher WER for learners vs native speakers
- Consider larger models (`whisper-small`) if users report issues

### Recommendation

**Keep current approach with enhancements**:

1. Update to `@huggingface/transformers` v3
2. Add model preloading during app initialization
3. Integrate VAD for smarter recording triggers

---

## 4. Web Audio Capture Patterns

### Recommended Approach: VAD-Only (MicVAD)

**Decision**: Use MicVAD as the sole audio capture mechanism. The existing AudioWorklet implementation is deprecated for new development.

**Why VAD-only**:
- MicVAD provides speech segments directly (`onSpeechEnd(audio: Float32Array)`)
- Built-in echo cancellation, noise suppression, auto gain control
- Silero VAD model for accurate speech detection
- Simpler architecture (no dual capture coordination)

```typescript
import { MicVAD } from '@ricky0123/vad-web';

const vad = await MicVAD.new({
  onSpeechStart: () => {
    // UI feedback: recording started
  },
  onSpeechEnd: (audio: Float32Array) => {
    // audio is 16kHz Float32Array
    // 1. Transcription: Pass Float32Array directly to Whisper
    transcribe(audio);
    // 2. Upload: Encode to WAV first (API expects audio/wav)
    const wavBlob = encodeWav(audio, 16000);
    uploadAudio(wavBlob);
  }
});

await vad.start();
```

### Audio Format: Float32Array → WAV Encoding

**Important**: MicVAD provides `Float32Array` at 16kHz, but the upload API expects `audio/wav`. Use a library for encoding.

**Recommended: [audiobuffer-to-wav](https://www.npmjs.com/package/audiobuffer-to-wav)**

```bash
bun add audiobuffer-to-wav
bun add -d @types/audiobuffer-to-wav
```

```typescript
// apps/web/asr/wav.ts
import toWav from "audiobuffer-to-wav";

/**
 * Convert Float32Array to WAV Blob.
 * MicVAD provides Float32Array at 16kHz; audiobuffer-to-wav expects AudioBuffer.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  // Create AudioBuffer from Float32Array
  const audioContext = new OfflineAudioContext(1, samples.length, sampleRate);
  const audioBuffer = audioContext.createBuffer(1, samples.length, sampleRate);
  audioBuffer.copyToChannel(samples, 0);

  // Encode to WAV using library
  const wavArrayBuffer = toWav(audioBuffer);
  return new Blob([wavArrayBuffer], { type: "audio/wav" });
}
```

**Why use a library**:
- WAV encoding has subtle edge cases (byte order, header structure, sample format)
- `audiobuffer-to-wav` is battle-tested (adapted from Recorder.js)
- TypeScript types available

**Content-Type**: Always use `audio/wav` for uploads. Future optimization: Opus encoding (10x smaller) can be added later.

### Legacy: AudioWorklet (Option C/D only)

The existing AudioWorklet implementation remains available for:
- **Option C (AudioWorklet-only)**: Manual speech detection without VAD
- **Option D (Sequential)**: Batch VAD analysis on recorded audio

If preserving AudioWorklet, ensure buffer copying (browser reuses buffers):

```javascript
// audioProcessor.ts
const copy = new Float32Array(channel);
this.port.postMessage(copy, [copy.buffer]); // Transfer ownership
```

### Model Preloading

Preload Whisper model during app initialization for instant transcription:

```typescript
useEffect(() => {
  pipeline('automatic-speech-recognition', 'Xenova/whisper-base')
    .then(() => setModelReady(true));
}, []);
```

---

## 5. Audio Upload Architecture

### Why Audio Upload is Required

Audio storage in R2 is **required** (not optional) for the scoring pipeline:

1. **Audio Understanding Models**: Gemini and similar models can analyze audio directly for pronunciation, fluency, and naturalness - features that text-only scoring cannot provide
2. **Cost-Effective**: Gemini audio analysis is relatively cheap compared to re-transcription
3. **Future-Proof**: Audio corpus enables model fine-tuning, pronunciation features, and QA

**Important**: Gemini audio analysis is for **additional scoring** in the backend pipeline, NOT for replacing client-side transcription. The flow is:
- Client: Local Whisper transcription (fast feedback)
- Server: Scoring pipeline fetches audio from R2 and runs Gemini analysis for advanced features (pronunciation, fluency assessment)

### ⚠️ CRITICAL: Scoring Race Condition

**Problem Identified**: The current flow has a race condition where scoring is enqueued immediately on turn submission, but audio upload happens asynchronously. The queue consumer may attempt to fetch audio from R2 before it exists.

**Current (Broken) Flow**:
```
T0: Client submits turn
    ├─ Handler validates and creates turn record
    ├─ Handler enqueues scoring to TURN_QUEUE ← RACE: Audio not uploaded yet!
    ├─ Handler emits TurnAccepted event
    └─ Returns { turnId }

T1: Client uploads audio (async, separate request)
    ├─ Uploads to R2
    ├─ Updates DB with audio_key
    └─ NO EVENT EMITTED ← Architectural gap!

T2: Queue consumer processes scoring
    ├─ Fetches turn from DB
    ├─ Fetches audio from R2 ← MAY NOT EXIST YET!
    └─ Runs scoring pipeline
```

### Proposed (Fixed) Flow with AudioUploaded Event

**Design Decision**: Audio upload must emit an `AudioUploaded` event to the EventLog. This:
1. Maintains EventLog as single source of truth (Architectural Invariant #1)
2. Enables scoring pipeline to gate on audio availability
3. Provides idempotency via requestId pattern

**Fixed Flow**:

```text
T0: Client submits turn (transcript only)
    ├─ Handler validates and creates turn record
    ├─ Handler emits TurnAccepted event to DO
    ├─ Room State: Processing (unchanged from current)
    ├─ Scoring Status: "awaiting_audio" (tracking field only)
    └─ Returns { turnId, status: "awaiting_audio" }

T1: Client uploads audio
    ├─ Handler validates requestId (idempotency)
    ├─ Uploads to R2 at turns/{turnId}
    ├─ Emits AudioUploaded event to DO ← NEW!
    ├─ Scoring Status: "ready_for_scoring"
    └─ DO event handler enqueues scoring ← Moved here!

T2: Queue consumer processes scoring
    ├─ Verifies AudioUploaded event exists
    ├─ Fetches audio from R2 (guaranteed to exist)
    └─ Runs scoring pipeline
```

**⚠️ State Scope Clarification (Review Iteration 2)**:

The `awaiting_audio` and `ready_for_scoring` states are **scoring status projections only**, NOT core room states. This distinction is critical:

| Aspect | Room State Machine | Scoring Status |
|--------|-------------------|----------------|
| **Purpose** | Turn progression, game flow | Audio/scoring tracking |
| **States** | AwaitingTurn, Processing, NpcPending | awaiting_audio, ready_for_scoring, scored |
| **Blocks flow?** | Yes (turn advancement) | **No** (fire-and-forget) |
| **Architecture ref** | "Processing does not wait for scoring" | Derived from EventLog |

The room continues to `Processing → AwaitingTurn` regardless of audio upload status. Scoring is fire-and-forget per the Processing State Semantics in `docs/ARCHITECTURE.md`: "AdvanceStep fires immediately, NOT gated by scoring."

### AudioUploaded Event Schema

```typescript
// Add to apps/api/src/domain/RoomEventGroup.ts

export class AudioUploadedPayload extends Schema.Class<AudioUploadedPayload>(
  "AudioUploadedPayload"
)({
  roomId: Schema.String,
  turnId: Schema.String,
  audioKey: Schema.String,
  requestId: Schema.String,  // Required for EventLog-level idempotency
  contentType: Schema.optional(Schema.String),
  fileSizeBytes: Schema.Number,
  durationMs: Schema.optional(Schema.Number),
  timestamp: Schema.Number
}) {}

// Add to RoomEventGroup:
.add({
  tag: "AudioUploaded",
  primaryKey: (payload: AudioUploadedPayload) => payload.roomId,
  payload: AudioUploadedPayload,
  success: Schema.Void,
  error: RoomEventHandlerError
})
```

### Audio Upload Idempotency

Following existing patterns (`turn_requests` table for turn submission):

```sql
-- Add to apps/api/db/schema.sql

-- Audio upload idempotency (prevent duplicate uploads)
CREATE TABLE IF NOT EXISTS audio_uploads (
  turn_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  content_type TEXT,
  file_size_bytes INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);

-- Request-level idempotency for audio uploads
CREATE TABLE IF NOT EXISTS audio_upload_requests (
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (turn_id, request_id),
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);
```

### ⚠️ Atomicity Requirement

**Problem Identified (Review Iteration 2)**: The previous design had an atomicity gap:
- If R2 upload + DB write succeed but DO event emission fails
- Room stays in `awaiting_audio` forever (no recovery)
- Idempotency check returns early without guaranteeing event exists

**Solution**: Idempotency must be tied to the DO event/command, not just DB state. If retry detects existing DB record but no event, re-emit the event.

### Updated Handler Implementation (Atomicity-Safe)

```typescript
// apps/api/src/http/handlers.ts

export const uploadTurnAudio = Effect.fn("handlers.uploadTurnAudio")(function* (input: {
  turnId: string;
  roomId: string;
  requestId: string;
  audio: ArrayBuffer;
  contentType?: string;
  sessionToken: string;  // Auth verification
}) {
  const bucket = yield* AudioBucket;
  const db = yield* Db;
  const roomDo = yield* RoomDoClient;

  // 1. Auth verification (same as other command paths)
  const session = yield* verifySession(input.sessionToken);
  const turn = yield* db.getTurnSubmission(input.turnId);
  if (turn.roomId !== input.roomId || turn.playerId !== session.playerId) {
    return yield* new AudioUploadFailed({ reason: "unauthorized" });
  }

  const audioKey = `turns/${input.turnId}`;

  // 2. Per-turn idempotency guard (prevents re-upload with different requestId)
  const existingTurnUpload = yield* db.getAudioUploadByTurnId(input.turnId);

  if (existingTurnUpload) {
    // Turn already has audio - verify event exists
    const eventExists = yield* db.hasAudioUploadedEvent(input.turnId);
    if (eventExists) {
      // Fully complete - return existing audioKey regardless of requestId
      return { audioKey: existingTurnUpload.audioKey, status: "already_uploaded" as const };
    }
    // Event missing - fall through to re-emit (R2 file already exists)
  } else {
    // 3. Request-level idempotency check (same requestId = same request retry)
    const existingRequest = yield* db.getAudioUploadByRequestId(input.turnId, input.requestId);

    if (!existingRequest) {
      // 4. Upload to R2 (first upload for this turn)
      yield* Effect.tryPromise({
        try: () => bucket.put(audioKey, input.audio, {
          httpMetadata: { contentType: input.contentType ?? "audio/wav" }
        }),
        catch: (cause) => new AudioUploadFailed({ reason: String(cause) })
      });

      // 5. Record upload for idempotency
      yield* db.recordAudioUpload({
        turnId: input.turnId,
        requestId: input.requestId,
        audioKey,
        contentType: input.contentType,
        fileSizeBytes: input.audio.byteLength,
        uploadedAt: Date.now()
      });
    }
    // If existingRequest exists but no event, fall through to re-emit
  }

  // 5. Emit AudioUploaded event to DO (idempotent at EventLog layer)
  // DO event handler will check its own idempotency and enqueue scoring
  yield* roomDo.emitRoomEvent(input.roomId, {
    type: "AudioUploaded",
    turnId: input.turnId,
    audioKey,
    contentType: input.contentType ?? "audio/wav",
    fileSizeBytes: input.audio.byteLength,
    requestId: input.requestId,  // Include for EventLog-level idempotency
    timestamp: Date.now()
  });

  // NOTE: Queue enqueue moved to DO event handler (see below)
  // This ensures correlation with EventLog write (event exists before queue job)

  return { audioKey, status: "uploaded" as const };
});
```

### DO Event Handler (Queue Enqueue Moved Here)

**Why**: Queue enqueue in HTTP handler breaks EventLog correlation. The queue job could exist without the event being committed. Moving enqueue to the event handler ensures the event exists before any queue job is created.

**⚠️ Effect.fork Semantics (Review Iteration 3)**:

`Effect.fork` is **not true atomicity** - it detaches the enqueued fiber from the handler's success/failure. This means:
- Event write can succeed while queue enqueue fails (rare, but possible)
- The forked fiber has its own error boundary

**Mitigation Strategy**:
1. **Queue consumer gates on AudioUploaded event** - If queue job exists but event doesn't, consumer skips
2. **Retry on missing queue job** - Periodic sweep for AudioUploaded events without corresponding queue job
3. **Observability** - Log queue enqueue failures for alerting

**Alternative (inline enqueue)**: Run enqueue without `Effect.fork` for true atomicity, but this blocks the event handler until queue accepts the message. For MVP, forked approach with monitoring is acceptable.

```typescript
// apps/api/src/domain/RoomEventHandlers.ts

.handle("AudioUploaded", ({ payload, entry }) =>
  Effect.gen(function* () {
    const persistence = yield* RoomStatePersistence;
    const idempotency = yield* AudioUploadIdempotency;
    const queue = yield* TurnQueue;

    // Idempotency at EventLog layer
    const alreadyProcessed = yield* idempotency.hasProcessed(payload.turnId);
    if (alreadyProcessed) {
      yield* Effect.logDebug(`Skipping duplicate AudioUploaded for ${payload.turnId}`);
      return;
    }

    // Record idempotency (atomic with state persistence)
    yield* idempotency.recordProcessed(payload.turnId, payload.audioKey);

    // Update state projection
    const current = yield* loadOrCreateState(payload.roomId, payload.timestamp);
    yield* persistence.upsertState(payload.roomId, new RoomProjection({
      ...current,
      lastEventId: entry.idString,
      updatedAt: payload.timestamp
    }));

    // Fire-and-forget: enqueue scoring
    // NOTE: Effect.fork detaches - queue failure won't fail event handler
    // Mitigation: Queue consumer gates on AudioUploaded event existence
    yield* Effect.fork(
      queue.enqueueTurn({
        roomId: payload.roomId,
        turnId: payload.turnId,
        status: "ready"
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(`Queue enqueue failed for turn ${payload.turnId}`, e)
        )
      )
    );
  })
)

### Cost Analysis

| Component | Free Tier | At Scale (500K turns/day) |
|-----------|-----------|---------------------------|
| R2 Storage | 10GB/mo | ~$113/mo (30-day retention) |
| R2 PUT ops | 1M/mo | ~$63/mo |
| Gemini Audio | - | TBD (much cheaper than Whisper) |
| Workers AI Whisper | - | **~$33K/day** (not recommended) |

### Future Enhancements

1. Add R2 lifecycle rules for auto-delete after 30 days
2. Consider presigned URLs for direct-to-R2 upload at scale
3. Compress to Opus (10x smaller) when ready
4. Gemini audio analysis in TurnScoringConsumer

---

## 6. Parakeet ASR Models (Multilingual)

### Key Findings

- **parakeet-tdt-0.6b-v3**: 600M params, 25 European languages, auto language detection
- **Speed**: 50x faster than Whisper (but server-side only)
- **Browser Support**: Emerging - ONNX export exists but not mature
- **Spanish**: Supported in v3 with ~4% WER on benchmarks

### Comparison

| Aspect | Parakeet v3 | Whisper |
|--------|-------------|---------|
| Browser Ready | Emerging | Production-ready |
| Spanish Support | Yes (v3) | Yes |
| Speed | 50x faster | Baseline |
| Model Size | 2.5GB | 73MB-3GB |
| Non-native Accents | Good | Good |

### Recommendation

**Stick with Whisper for browser**:
- Mature Transformers.js integration
- Smaller model options
- Better tested for our use case

**Consider Parakeet for server-side** if:
- Need real-time streaming transcription
- Processing long recordings at scale
- Building features requiring server-side ASR

---

## Recommended Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Browser Client                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ VadService (owns microphone capture)                          │   │
│  │                                                               │   │
│  │  MicVAD.new({ ... }) ─────────────────────────────────────┐  │   │
│  │       │                                                    │  │   │
│  │       ├─ onSpeechStart → SpeechStart event                 │  │   │
│  │       ├─ onSpeechEnd(audio: Float32Array) → SpeechEnd      │  │   │
│  │       └─ onFrameProcessed → FrameProcessed                 │  │   │
│  │                                                            │  │   │
│  │  Stream.asyncScoped (cleanup runs on scope end)            │  │   │
│  └────────────────────────────────────────────────────────────┘   │
│                                   │                                 │
│                                   │ SpeechEnd { audio }             │
│                                   ▼                                 │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ TranscriptionService                                            ││
│  │   (whisper-base, memoized loading via Effect.memoize)           ││
│  │        │                                                        ││
│  │        ▼                                                        ││
│  │   { transcript, audio, durationMs }                             ││
│  └────────────────────────────────────────────────────────────────┘│
│                                   │                                 │
│                                   ▼                                 │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Turn Submission (with idempotency)                              ││
│  │                                                                 ││
│  │ 1. POST /api/rooms/:roomId/turns (transcript) → TurnAccepted   ││
│  │    └─ Returns { turnId, status: "awaiting_audio" }             ││
│  │                                                                 ││
│  │ 2. POST /api/turns/:turnId/audio (WAV + requestId)             ││
│  │    └─ R2 upload → AudioUploaded event → Enqueue scoring        ││
│  │    └─ Returns { audioKey, status: "uploaded" }                 ││
│  └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Cloudflare (EventLog-Driven Architecture)                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Durable Object (EventLogRoom)                                 │  │
│  │                                                               │  │
│  │  EventLog (source of truth)                                   │  │
│  │  ├─ TurnAccepted    → State: awaiting_audio                   │  │
│  │  ├─ AudioUploaded   → State: ready_for_scoring ← NEW!         │  │
│  │  ├─ ScoreUpdated    → State: scored                           │  │
│  │  └─ TurnAdvanced    → State: next_turn                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                    │                                                │
│                    ▼ (AudioUploaded triggers)                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ TURN_QUEUE → TurnScoringConsumer                              │  │
│  │                                                               │  │
│  │  1. Verify AudioUploaded event exists                         │  │
│  │  2. Fetch audio from R2 (guaranteed to exist)                 │  │
│  │  3. Run text scoring (fluency, vocab, grammar)                │  │
│  │  4. Run Gemini audio analysis (pronunciation, fluency)        │  │
│  │  5. Emit ScoreUpdated event                                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                    │                                                │
│                    ▼                                                │
│  ┌─────────────────┐    ┌─────────────────┐                        │
│  │ R2 Audio Bucket │    │ Gemini Audio    │                        │
│  │ (required)      │───▶│ Analysis        │                        │
│  └─────────────────┘    └─────────────────┘                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Effect Wrappers Required

### Design Decision: VAD Integration Pattern

**Question**: Should MicVAD REPLACE the AudioWorklet or GATE it?

**⚠️ Review Iteration 3 Correction**: MicVAD **does support custom `getStream` and `audioContext`** (see `RealTimeVADOptions` in the types). Shared-stream capture IS technically feasible:

```typescript
// Shared-stream pattern (possible, but adds complexity)
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const audioContext = new AudioContext({ sampleRate: 16000 });

const vad = await MicVAD.new({
  audioContext,  // Share audio context
  getStream: async () => stream,  // Share MediaStream
  // ... other options
});

// AudioWorklet can use the same stream/context
const source = audioContext.createMediaStreamSource(stream);
// ... connect to worklet
```

However, this adds architectural complexity for minimal benefit. **VAD-only is still recommended for simplicity.**

**Four Valid Options**:

| Option | Description | Pros | Cons |
| ------ | ----------- | ---- | ---- |
| **A: VAD-Only** | MicVAD owns capture, provides speech segments | Simplest, proven | Less raw audio control |
| **B: Shared-Stream** | AudioWorklet + MicVAD share MediaStream | Both capabilities | Complex setup, sync issues |
| **C: AudioWorklet-Only** | Current approach, no real-time VAD | Single source, proven | Manual speech detection |
| **D: Sequential** | AudioWorklet captures, batch VAD analysis | Best of both worlds | Adds latency |

**Recommendation: Option A (VAD-Only) for simplicity**

MicVAD already provides:

- `onSpeechEnd(audio: Float32Array)` - Speech segments at 16kHz
- Built-in echo cancellation, noise suppression, auto gain
- Silero VAD model for speech detection

The existing AudioWorklet can be deprecated for this use case. If raw audio control is needed later, Option B (shared-stream) is available.

```text
┌─────────────────────────────────────────────────────────────────┐
│ Option A: VAD-Only (Recommended)                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MicVAD.new({                                                   │
│    onSpeechEnd: (audio: Float32Array) => {                      │
│      // Already segmented speech at 16kHz                       │
│      transcribe(audio);                                         │
│      upload(audio);                                             │
│    }                                                            │
│  })                                                             │
│                                                                 │
│  ✓ Single capture source (no dual MediaStream conflict)        │
│  ✓ Automatic speech segmentation                                │
│  ✓ Built-in audio preprocessing                                 │
│  ✓ Simpler architecture                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Alternative: Option D (Sequential) for existing AudioWorklet users**

If preserving AudioWorklet is required, use `NonRealTimeVAD` for batch analysis:

```typescript
// Capture via AudioWorklet (existing code)
const capture = yield* WorkletCapture;

// Collect audio into Float32Array (NonRealTimeVAD.run expects Float32Array, not AudioBuffer)
const audioFloat32: Float32Array = yield* capture.getRecordedAudio();

// On stop, analyze recorded audio with NonRealTimeVAD
const vad = yield* Effect.tryPromise({
  try: () => NonRealTimeVAD.new(),
  catch: (e) => new VadError({ reason: String(e) })
});

// run() returns AsyncGenerator<NonRealTimeVADSpeechData>
for await (const segment of vad.run(audioFloat32, 16000)) {
  // segment.audio is Float32Array of speech
  yield* transcribe(segment.audio);
}
```

### VAD Service (Effect-native wrapper for @ricky0123/vad-web)

**Anti-Pattern**: Separate `start/stop` methods encourage manual lifecycle management and leaks.

```typescript
// ❌ WRONG: Requires caller to manage lifecycle
interface VadService {
  start: () => Effect.Effect<void>;
  stop: () => Effect.Effect<void>;
  speechEvents: Stream.Stream<VadEvent>;
}
```

**⚠️ Review Iteration 2 Fix**: The previous implementation used `Stream.asyncPush` which **ignores the return value** of the register function. Cleanup effects (`vad.pause()`, `vad.destroy()`) would never run.

**Correct Pattern**: Use `Stream.asyncScoped` which expects the register function to return a cleanup Effect.

```typescript
// ✅ CORRECT: Layer.scoped with Stream.asyncScoped (NOT asyncPush!)
import { Context, Effect, Layer, Stream, Schema } from "effect";

// Error types
export class VadInitError extends Schema.TaggedError<VadInitError>()(
  "VadInitError",
  { reason: Schema.String }
) {}

// Event types
export type VadEvent =
  | { readonly _tag: "SpeechStart"; readonly timestamp: number }
  | { readonly _tag: "SpeechEnd"; readonly timestamp: number; readonly audio: Float32Array }
  | { readonly _tag: "FrameProcessed"; readonly probability: number };

// Service interface - provides a Stream, not start/stop methods
export interface VadServiceImpl {
  readonly events: Stream.Stream<VadEvent, VadInitError>;
}

export class VadService extends Context.Tag("VadService")<
  VadService,
  VadServiceImpl
>() {}

// Implementation using Stream.asyncScoped (NOT asyncPush!)
// asyncScoped expects register to return a cleanup Effect
const makeVadService = Effect.gen(function* () {
  const events = Stream.asyncScoped<VadEvent, VadInitError>(
    (emit) =>
      Effect.gen(function* () {
        // Dynamic import for browser-only code
        const VadWeb = yield* Effect.tryPromise({
          try: () => import("@ricky0123/vad-web"),
          catch: (cause) => new VadInitError({ reason: `Import failed: ${cause}` })
        });

        // Build VAD instance with asset paths for Bun hosting
        // See "MicVAD Asset Hosting" section below for setup
        const vad = yield* Effect.tryPromise({
          try: () => VadWeb.MicVAD.new({
            // Asset paths - must match Bun.serve static file routes
            baseAssetPath: "/vad",           // Worklet JS files
            onnxWASMBasePath: "/vad/onnx",   // ONNX runtime WASM files

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

        // Start listening
        yield* Effect.tryPromise({
          try: () => vad.start(),
          catch: (cause) => new VadInitError({ reason: `VAD start failed: ${cause}` })
        });

        // Return cleanup Effect - asyncScoped will run this when scope ends
        // This is the critical difference from asyncPush!
        return Effect.sync(() => {
          vad.pause();
          vad.destroy();
        });
      }),
    { bufferSize: 64, strategy: "sliding" }  // Real-time: drop old events
  );

  return { events };
});

// Layer handles scope lifecycle automatically
export const VadServiceLive = Layer.scoped(VadService, makeVadService);
```

**Why asyncScoped vs asyncPush**:

| Aspect | `asyncPush` | `asyncScoped` |
|--------|-------------|---------------|
| Return value | **Ignored** | **Runs as cleanup** |
| Use case | Fire-and-forget callbacks | Resources with cleanup |
| Cleanup guarantee | None | Automatic on scope end |
| VAD/Audio use | ❌ Wrong | ✅ Correct |

**Usage** (lifecycle is automatic):

```typescript
// Consumer code - no manual start/stop!
const program = Effect.gen(function* () {
  const vad = yield* VadService;

  yield* Stream.runForEach(vad.events, (event) => {
    if (event._tag === "SpeechEnd") {
      // Transcribe the speech segment
      return transcriber.transcribe(event.audio);
    }
    return Effect.void;
  });
});

// Run with layer - cleanup automatic when scope closes
// vad.pause() and vad.destroy() WILL run when stream ends
Effect.runPromise(
  program.pipe(Effect.provide(VadServiceLive))
);
```

### MicVAD Asset Hosting

MicVAD requires several static files that must be served by the web server:

| Asset | Source | Path |
| ----- | ------ | ---- |
| VAD Worklet | `node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js` | `/vad/vad.worklet.bundle.min.js` |
| Silero ONNX | `node_modules/@ricky0123/vad-web/dist/silero_vad.onnx` | `/vad/silero_vad.onnx` |
| ONNX Runtime | `node_modules/onnxruntime-web/dist/*.wasm` | `/vad/onnx/*.wasm` |

#### Local Development (Bun.serve)

For local development, `Bun.serve` handles static assets:

```typescript
// apps/web/dev.ts
Bun.serve({
  routes: {
    "/": indexHtml,
    "/vad/*": async (req) => {
      const path = new URL(req.url).pathname;
      const file = Bun.file(`./public${path}`);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not found", { status: 404 });
    },
  },
});
```

#### Production (Cloudflare)

**Architecture Clarification**: The production stack is Cloudflare-based:

| Layer | Technology | Purpose |
| ----- | ---------- | ------- |
| **Static Assets** | Cloudflare Pages | HTML, JS, CSS, VAD assets (WASM, ONNX) |
| **API** | Cloudflare Workers | HTTP handlers, queue consumers |
| **State** | Durable Objects | EventLog, room state |
| **Storage** | R2 | Audio files |

For production, VAD assets are deployed to Cloudflare Pages alongside the frontend bundle:

```bash
# Build step: copy assets to Pages output directory
mkdir -p dist/vad/onnx
cp node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js dist/vad/
cp node_modules/@ricky0123/vad-web/dist/silero_vad.onnx dist/vad/
cp node_modules/onnxruntime-web/dist/*.wasm dist/vad/onnx/
```

**wrangler.toml** (Pages configuration):

```toml
# Static assets served from Pages
[site]
bucket = "./dist"
```

**Content-Types**: Both Bun and Cloudflare auto-detect based on extension. WASM files are served as `application/wasm`.

### Transformers.js Service (Effect wrapper for @huggingface/transformers)

**Problem**: Concurrent `loadModel()` calls can spawn multiple downloads, wasting bandwidth and memory.

**Solution**: Use `Effect.memoize` for single-flight model loading.

```typescript
import { Context, Effect, Layer, Ref, Stream, Schema } from "effect";

// Error types
export class ModelLoadError extends Schema.TaggedError<ModelLoadError>()(
  "ModelLoadError",
  { reason: Schema.String }
) {}

export class TranscriptionError extends Schema.TaggedError<TranscriptionError>()(
  "TranscriptionError",
  { reason: Schema.String }
) {}

// Progress events for UI feedback
export type LoadProgress = {
  readonly status: "initiate" | "download" | "progress" | "done" | "ready";
  readonly file?: string;
  readonly progress?: number;
  readonly loaded?: number;
  readonly total?: number;
};

// Service interface
export interface TranscriptionServiceImpl {
  readonly transcribe: (
    audio: Float32Array,
    sampleRate: number
  ) => Effect.Effect<string, TranscriptionError>;
  readonly loadProgress: Stream.Stream<LoadProgress>;
  readonly isModelReady: Effect.Effect<boolean>;
}

export class TranscriptionService extends Context.Tag("TranscriptionService")<
  TranscriptionService,
  TranscriptionServiceImpl
>() {}

// Implementation with single-flight model loading
const makeTranscriptionService = Effect.gen(function* () {
  const modelRef = yield* Ref.make<Pipeline | null>(null);
  const progressQueue = yield* Queue.sliding<LoadProgress>(32);

  // Memoized model loader - concurrent calls share same result
  const ensureModel = yield* Effect.memoize(
    Effect.gen(function* () {
      progressQueue.unsafeOffer({ status: "initiate" });

      const { pipeline } = yield* Effect.tryPromise({
        try: () => import("@huggingface/transformers"),
        catch: (cause) => new ModelLoadError({ reason: `Import failed: ${cause}` })
      });

      const model = yield* Effect.tryPromise({
        try: () => pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
          progress_callback: (info: LoadProgress) => {
            progressQueue.unsafeOffer(info);
          }
        }),
        catch: (cause) => new ModelLoadError({ reason: `Load failed: ${cause}` })
      });

      yield* Ref.set(modelRef, model);
      progressQueue.unsafeOffer({ status: "ready" });
      return model;
    })
  );

  const transcribe = Effect.fn("TranscriptionService.transcribe")(function* (
    audio: Float32Array,
    sampleRate: number
  ) {
    const model = yield* ensureModel;

    const result = yield* Effect.tryPromise({
      try: () => model({ audio, sampling_rate: sampleRate }),
      catch: (cause) => new TranscriptionError({ reason: `Transcription failed: ${cause}` })
    });

    return result.text;
  });

  return {
    transcribe,
    loadProgress: Stream.fromQueue(progressQueue),
    isModelReady: Ref.get(modelRef).pipe(Effect.map((m) => m !== null))
  };
});

export const TranscriptionServiceLive = Layer.effect(
  TranscriptionService,
  makeTranscriptionService
);
```

### Buffer Strategy Decision

| Use Case | Strategy | Capacity | Rationale |
| -------- | -------- | -------- | --------- |
| VAD events | `sliding` | 64 | Real-time, drop old events |
| Audio chunks (Option D only) | `sliding` | 200 (~1.6s) | Legacy AudioWorklet; drop oldest |
| Transcription results | `dropping` | 16 | Drop latest if consumer slow |
| EventLog streaming | `unbounded` | N/A | Never lose events |

### Key Effect Patterns Used

| Pattern | Primitive | Use Case |
| ------- | --------- | -------- |
| Callback → Stream | `Stream.asyncScoped` | MicVAD callbacks (with cleanup) |
| Resource cleanup | `Effect.acquireRelease` | Audio context, workers |
| Scoped resources | `Layer.scoped` | Services with cleanup |
| Single-flight | `Effect.memoize` | Model loading |
| Typed errors | `Schema.TaggedError` | All service errors |

---

## Implementation Priorities

### Phase 1: Critical Path (Immediate)

**Goal**: Fix the scoring race condition and establish EventLog-driven audio flow.

| Priority | Task | Issue | Rationale |
| -------- | ---- | ----- | --------- |
| P0 | Add AudioUploaded event to RoomEventGroup | ensayo_quest-NEW | Fixes race condition |
| P0 | Update uploadTurnAudio handler with idempotency | ensayo_quest-NEW | EventLog compliance |
| P0 | Move scoring enqueue to AudioUploaded DO event handler | ensayo_quest-NEW | Guarantees R2 exists (Invariant #9) |
| P1 | Add audio_uploads idempotency table | ensayo_quest-NEW | Prevents duplicate uploads |
| P1 | Gate TurnScoringConsumer on AudioUploaded | ensayo_quest-NEW | Defense in depth |

### Phase 2: Frontend Voice Services

**Goal**: Implement Effect-native VAD and transcription services using VAD-only capture.

| Priority | Task | Issue | Rationale |
| -------- | ---- | ----- | --------- |
| P2 | Implement VadService with Stream.asyncScoped | ensayo_quest-nhn | VAD-only capture with cleanup |
| P2 | Implement TranscriptionService with memoized loading | ensayo_quest-5p0 | Single-flight model load |
| P3 | Add Whisper model preloading | ensayo_quest-m3q | Better UX |
| P3 | Add model loading progress UI | - | User feedback |
| P4 | (Legacy) Fix AudioWorklet buffer copying | ensayo_quest-ao8 | Option D only - if AudioWorklet needed |

### Phase 3: Polish & Optimization

**Goal**: Production-ready audio pipeline with good UX.

| Priority | Task | Rationale |
|----------|------|-----------|
| P3 | R2 lifecycle rules for auto-delete | Cost management |
| P3 | Upload progress indicator in UI | User feedback |
| P3 | VAD sensitivity slider | User preference |
| P3 | Confidence thresholds for transcription | Quality filtering |
| P4 | Opus compression (10x smaller) | Bandwidth optimization |

### Phase 4: Future Consideration

| Task | Trigger |
|------|---------|
| TanStack Start migration | When 1.0 releases |
| Parakeet server-side | If real-time streaming needed |
| whisper-small option | If users report accuracy issues |
| Gemini audio analysis | Backend scoring enhancement |

### Dependency Graph

```text
Phase 1 (Critical Path)
├── AudioUploaded event
│   ├── Updated handler
│   └── Scoring gate
└── Idempotency tables

Phase 2 (Voice Services) ─ depends on Phase 1
├── VadService
│   └── TranscriptionService ─ depends on VadService
│       └── Model preloading ─ depends on TranscriptionService
└── Buffer copying fix (independent)

Phase 3 (Polish) ─ depends on Phase 2
└── All tasks independent
```

---

## Package Updates

```json
{
  "dependencies": {
    "@huggingface/transformers": "^3.0.0",
    "@ricky0123/vad-web": "^0.0.22",
    "@effect-atom/atom-react": "^0.4.5",
    "audiobuffer-to-wav": "^1.0.0"
  },
  "devDependencies": {
    "@types/audiobuffer-to-wav": "^1.0.0"
  }
}
```

---

## 8. Model Caching Research Findings

### How Transformers.js Caches Models

**Primary mechanism**: Cache API (`caches.open('transformers-cache')`)
- Models downloaded from Hugging Face Hub are automatically cached
- Subsequent loads are instant from cache
- Works offline once cached

### Configuration Options

```typescript
import { env } from '@huggingface/transformers';

env.useBrowserCache = true;       // Enable Cache API (default: true)
env.allowRemoteModels = true;     // Allow HF Hub downloads (default: true)
env.localModelPath = '/models/';  // Self-host models path
env.allowLocalModels = false;     // Try local before remote
```

### Progress Tracking

```typescript
const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
  progress_callback: (info) => {
    if (info.status === 'progress') {
      console.log(`${info.file}: ${info.progress}% (${info.loaded}/${info.total})`);
    }
  }
});
```

### Cache Management Utilities

```typescript
// Check if model is cached
async function isModelCached(modelId: string): Promise<boolean> {
  const cache = await caches.open('transformers-cache');
  const keys = await cache.keys();
  return keys.some(req => req.url.includes(encodeURIComponent(modelId)));
}

// Get storage info
async function getStorageInfo() {
  const { usage, quota } = await navigator.storage.estimate();
  return {
    usedMB: Math.round(usage / (1024 * 1024)),
    quotaMB: Math.round(quota / (1024 * 1024)),
    availableMB: Math.round((quota - usage) / (1024 * 1024))
  };
}

// Request persistent storage (prevents eviction)
async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return await navigator.storage.persist();
  }
  return false;
}

// Clear cache
async function clearModelCache(): Promise<boolean> {
  return await caches.delete('transformers-cache');
}
```

### Browser Storage Quotas

| Browser | Quota | Notes |
|---------|-------|-------|
| Chrome/Edge | 60% of disk | Most generous |
| Firefox | 10% of disk or 10GB | Group limit |
| Safari Desktop | 60% of disk | **7-day eviction without interaction** |
| Safari iOS | ~50MB-1GB | Most restrictive |

### Safari 7-Day Eviction Workaround

Safari evicts Cache API storage after 7 days without user interaction. Mitigations:
1. **PWA installation** - Home screen apps exempt from eviction
2. **Request persistent storage** - `navigator.storage.persist()`
3. **Re-validate on load** - Check cache, re-download if needed

### Offline Behavior

- **Cached**: Works fully offline
- **Not cached + offline**: Fails with network error - must handle gracefully

---

## Open Questions (Answered)

### Q1: Should audio-based scoring be triggered by an AudioUploaded event rather than assuming immediate R2 availability?

**Answer: YES** - This is the primary fix for the race condition.

The scoring pipeline must be gated on the `AudioUploaded` event. The flow becomes:
1. TurnAccepted event → State: `awaiting_audio`
2. Audio upload → AudioUploaded event → State: `ready_for_scoring` → Enqueue scoring
3. Queue consumer verifies AudioUploaded exists before fetching from R2

This aligns with Architectural Invariant #1 (EventLog is source of truth).

### Q2: Should the audio upload endpoint be a first-class command with requestId and idempotency table entry tied to the turn?

**Answer: YES** - Following the existing `turn_requests` pattern.

Implementation:
- Client provides `requestId` with each audio upload request
- Server checks `audio_upload_requests` table before uploading
- Duplicate requests return cached `audioKey` immediately
- Protects against double-uploads on network retries

### Q3: Is MicVAD intended to replace the AudioWorklet capture or only gate it?

**Answer (Updated in Review Iteration 3): VAD-ONLY recommended**, but shared-stream IS possible.

**Correction**: MicVAD supports custom `getStream` and `audioContext` options (see `RealTimeVADOptions`). Shared-stream capture is technically feasible but adds complexity.

**Four valid options** (see Section 7 for details):

| Option | Approach | Recommendation |
| ------ | -------- | -------------- |
| **A: VAD-Only** | MicVAD owns capture | ✅ Recommended (simplest) |
| **B: Shared-Stream** | AudioWorklet + MicVAD share MediaStream | If both needed |
| **C: AudioWorklet-Only** | No real-time VAD | Keep if VAD not needed |
| **D: Sequential** | Batch VAD on recorded audio | If latency acceptable |

### Q4: Should model loading and cache persistence be scoped per session, or shared app-wide with explicit cache invalidation controls?

**Answer: SESSION-SCOPED** for MVP, with explicit cache configuration.

Rationale:
- **Simpler**: No shared state management, automatic updates on page reload
- **Cache API persistence**: Transformers.js already uses browser Cache API (IndexedDB/Blob)
- **Session isolation**: Clean slate for each session
- **Safari workaround**: Request persistent storage via `navigator.storage.persist()`

For MVP:
1. Enable `env.useBrowserCache = true` explicitly
2. Add cache diagnostics (hit/miss logging)
3. Request persistent storage on app init
4. Pre-warm cache in background during boot

For future (if needed):
- Shared model manager with version-aware caching
- Explicit cache invalidation UI
- Service worker for background model warming

### Q5: VAD sensitivity tuning - What threshold works best for language learners?

**Answer: Start with defaults, tune based on feedback.**

MicVAD uses Silero VAD model with configurable thresholds:
- `positiveSpeechThreshold`: 0.5 (default) - when to start detecting speech
- `negativeSpeechThreshold`: 0.35 (default) - when to stop detecting speech
- `minSpeechFrames`: 3 (default) - minimum frames to confirm speech
- `preSpeechPadFrames`: 1 (default) - frames to include before speech start

For language learners:
- May need **lower thresholds** (0.3-0.4) for hesitant speakers
- May need **higher `minSpeechFrames`** to avoid false positives on "um", "uh"
- Consider exposing sensitivity slider in UI for user preference

### Q6: Model size trade-off - Should we offer whisper-small for better accuracy?

**Answer: Stick with whisper-base for now.**

| Model | Size | Download Time | Transcription Time | WER |
|-------|------|---------------|-------------------|-----|
| whisper-tiny | 39MB | ~5s | ~2s | Higher |
| whisper-base | 74MB | ~10s | ~5s | Medium |
| whisper-small | 244MB | ~30s | ~15s | Lower |

Recommendation:
- **whisper-base** is the right balance for MVP
- Add UI to show transcription confidence scores
- If users report accuracy issues, offer whisper-small as opt-in
- Consider pre-downloading whisper-small in background for power users

### Q7: Should queue enqueue be inline (true atomicity) or forked (fire-and-forget)?

**Answer (Review Iteration 3): FORKED with monitoring** for MVP.

| Approach | Atomicity | Latency | Failure Mode |
| -------- | --------- | ------- | ------------ |
| **Inline** | True | Blocks handler | Event fails if queue fails |
| **Forked** | Eventual | Non-blocking | Queue failure independent |

**Decision**: Use `Effect.fork` with explicit error logging and monitoring. Mitigations:
1. Queue consumer gates on AudioUploaded event existence
2. Periodic sweep for AudioUploaded events without queue jobs (future)
3. Observability: log queue enqueue failures for alerting

**Rationale**: True atomicity would couple event persistence to queue availability. For MVP, eventual consistency with monitoring is acceptable. If queue failures become common, migrate to inline approach.

---

## Testing Gaps

Critical test scenarios identified during architecture review:

### Audio Upload Atomicity Tests

1. **R2 success + DB success + DO event failure**
   - Verify retry re-emits AudioUploaded event
   - Verify room doesn't stay stuck in awaiting state
   - Verify no duplicate R2 uploads on retry

2. **Idempotency tests**
   - Repeated `requestId` returns same `audioKey` without re-upload
   - Queue consumer gates on AudioUploaded event existence
   - EventLog-level idempotency prevents duplicate scoring enqueue

### VadService Cleanup Tests

3. **Stream scope cleanup**
   - Verify `vad.pause()` and `vad.destroy()` run when stream ends
   - Test cleanup on consumer cancel/abort
   - Test cleanup on error during VAD initialization

### Queue Atomicity Tests

4. **Queue enqueue in DO handler**
   - Verify queue job exists only when AudioUploaded event exists
   - Test retry doesn't create duplicate queue jobs
   - Verify scoring consumer handles missing audio gracefully

5. **Effect.fork failure scenarios (Review Iteration 3)**
   - Event succeeds but forked queue enqueue fails → verify error is logged
   - Periodic sweep finds AudioUploaded events without queue jobs → verify re-enqueue
   - Queue consumer skips if AudioUploaded event doesn't exist

### Test File Locations

```text
apps/api/src/http/__tests__/audio-upload.test.ts        # NEW: atomicity tests
apps/api/src/workers/__tests__/TurnScoringConsumer.integration.test.ts  # Extend
apps/web/asr/__tests__/vad-service.test.ts              # NEW: cleanup tests
```

---

## 14. CI/CD Pipeline Architecture

### Overview

The project uses GitHub Actions with Cloudflare Pages (frontend) and Cloudflare Workers (API) for deployments. Multi-environment support enables preview deployments per PR, staging on main, and production on release tags.

### Deployment Targets

| Component | Platform | Deploy Method |
|-----------|----------|---------------|
| Frontend (`apps/web`) | Cloudflare Pages | `wrangler pages deploy` |
| API (`apps/api`) | Cloudflare Workers | `wrangler deploy` |

### Environment Strategy

| Environment | Trigger | Workers Env | Pages Branch |
|-------------|---------|-------------|--------------|
| Preview | PR opened | N/A | `pr-123` |
| Staging | Push to `main` | `--env staging` | `main` |
| Production | Tag `v*` | `--env production` | `production` |

### Pipeline Stages

```text
┌──────────┐    ┌──────────────┐    ┌────────────────┐
│   Test   │───►│  Build Web   │───►│  Deploy Stage  │
│  (lint,  │    │  (bun build) │    │  (conditional) │
│  types,  │    │              │    │                │
│  tests)  │    │              │    │                │
└──────────┘    └──────────────┘    └────────────────┘
                                           │
                      ┌────────────────────┼────────────────────┐
                      │                    │                    │
                      ▼                    ▼                    ▼
              ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
              │   Preview    │    │   Staging    │    │  Production  │
              │   (PR only)  │    │  (main push) │    │  (v* tag)    │
              │              │    │              │    │              │
              │ Pages only   │    │ D1 migrate   │    │ D1 migrate   │
              │ Comment URL  │    │ Workers      │    │ Workers      │
              │              │    │ Pages        │    │ Pages        │
              └──────────────┘    └──────────────┘    └──────────────┘
```

### D1 Migrations

Migrations live in `apps/api/migrations/` and follow D1 naming convention:

```
migrations/
├── 0001_initial_schema.sql
├── 0002_add_audio_uploads.sql  (future)
└── ...
```

Apply migrations before deploying workers:
```bash
wrangler d1 migrations apply ensayo_quest --env staging --remote
wrangler d1 migrations apply ensayo_quest --env production --remote
```

### Resource Isolation

| Resource | Staging | Production |
|----------|---------|------------|
| D1 Database | `ensayo_quest_staging` | `ensayo_quest` |
| R2 Bucket | `ensayo-audio-staging` | `ensayo-audio` |
| Vectorize | `ensayo-spanish-staging` | `ensayo-spanish` |
| Queue | `turn-scoring-staging` | `turn-scoring` |

### Required Secrets (GitHub Repository Settings)

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | API token with Workers, Pages, D1, R2 permissions |

### Local Development vs Production

| Aspect | Local (Bun) | Production (Cloudflare) |
|--------|-------------|------------------------|
| Frontend Server | `bun --hot apps/web/index.ts` | Cloudflare Pages |
| API Server | `wrangler dev` (miniflare) | Cloudflare Workers |
| Database | Local D1 (SQLite) | Remote D1 |
| Audio Storage | Local filesystem | R2 |
| VAD Assets | `Bun.serve` at `/vad/*` | Pages static assets |

### Workflow File Location

`.github/workflows/ci.yml` - single workflow handling all environments.

---

## Sources

- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js/index)
- [TanStack Start Overview](https://tanstack.com/start/latest/docs/framework/react/overview)
- [Vercel AI SDK Voice Features](https://ai-sdk.dev/docs/ai-sdk-core/speech)
- [NVIDIA Parakeet Models](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [@ricky0123/vad-web](https://github.com/ricky0123/vad)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
