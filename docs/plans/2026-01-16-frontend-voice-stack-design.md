# Frontend Voice Stack Design

**Date**: 2026-01-16
**Issue**: ensayo_quest-k7e (Research frontend stack for voice/audio pipeline)
**Status**: Research Complete

---

## Executive Summary

This document compiles research findings from six parallel investigations into modernizing Ensayo Quest's frontend voice/audio pipeline. The recommendation is a **hybrid architecture** with:

1. **Client-side ASR**: Whisper via Transformers.js (current approach, validated)
2. **Frontend Framework**: TanStack Start for type-safe routing and server functions
3. **Voice Activity Detection**: Effect-native wrapper around @ricky0123/vad-web
4. **Audio Upload**: Required - R2 storage enables advanced scoring via audio understanding models (Gemini)
5. **Effect Integration**: Custom Effect wrappers for VAD and Transformers.js APIs

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

### Current Implementation Analysis

Our AudioWorklet implementation is **solid**:
- 16kHz capture via AudioContext
- Sliding queue (200 chunks ~1.6s buffer)
- Effect-based worker communication

### Recommended Enhancements

1. **Copy buffers in AudioWorklet** (browser reuses them):
```javascript
// audioProcessor.ts
const copy = new Float32Array(channel);
this.port.postMessage(copy, [copy.buffer]); // Transfer ownership
```

2. **Add Voice Activity Detection**:
```typescript
import { MicVAD } from '@ricky0123/vad-web';

const vad = await MicVAD.new({
  onSpeechEnd: (audio) => {
    // Float32Array at 16kHz - send to worker
    worker.executeEffect(buildTranscribeRequest(audio, 16000));
  }
});
```

3. **Preload Whisper model**:
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

### Current Flow

```
Browser                           API
-------                           ---
1. AudioWorklet capture
2. Whisper transcription (local)
3. POST /api/rooms/:roomId/turns  →  Insert turn, enqueue scoring
4. Receive turnId                 ←
5. POST /api/turns/:turnId/audio  →  Store in R2 (REQUIRED)
                                      ↓
                              Queue Consumer fetches audio
                                      ↓
                              Gemini audio analysis (future)
```

### Cost Analysis

| Component | Free Tier | At Scale (500K turns/day) |
|-----------|-----------|---------------------------|
| R2 Storage | 10GB/mo | ~$113/mo (30-day retention) |
| R2 PUT ops | 1M/mo | ~$63/mo |
| Gemini Audio | - | TBD (much cheaper than Whisper) |
| Workers AI Whisper | - | **~$33K/day** (not recommended) |

### Recommendation

**Hybrid approach with required upload**:
- Client transcription for immediate feedback (low latency UX)
- Audio always uploaded to R2 for scoring pipeline
- Scoring pipeline uses audio understanding models (Gemini) for advanced features
- **Do not** re-transcribe server-side (use Gemini for audio analysis instead)

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

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser Client                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐     ┌──────────────────┐                       │
│  │ @ricky0123/     │────▶│ AudioWorklet     │                       │
│  │ vad-web         │     │ (16kHz capture)  │                       │
│  │ (speech detect) │     └────────┬─────────┘                       │
│  └─────────────────┘              │                                 │
│                                   │ Float32Array                    │
│                                   ▼                                 │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Effect Stream Pipeline                                          ││
│  │ ┌─────────────┐   ┌─────────────┐   ┌────────────────────────┐ ││
│  │ │ VAD Filter  │ → │ Accumulator │ → │ Web Worker             │ ││
│  │ │             │   │ (utterance) │   │ (whisper-base)         │ ││
│  │ └─────────────┘   └─────────────┘   └────────────────────────┘ ││
│  └────────────────────────────────────────────────────────────────┘│
│                                   │                                 │
│                                   ▼ { transcript, audio }          │
│  ┌────────────────────────────────────────────────────────────────┐│
│  │ Turn Submission                                                 ││
│  │ 1. POST /api/rooms/:roomId/turns (transcript)                  ││
│  │ 2. POST /api/turns/:turnId/audio (WAV) - REQUIRED              ││
│  └────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Cloudflare (Existing Infrastructure)                                │
├─────────────────────────────────────────────────────────────────────┤
│  Worker API → D1 → Queue → TurnScoringConsumer → Durable Object    │
│                                      │                              │
│                                      ▼                              │
│                            ┌─────────────────┐                      │
│                            │ R2 Audio Bucket │                      │
│                            │ (required)      │                      │
│                            └────────┬────────┘                      │
│                                     │                               │
│                                     ▼                               │
│                            ┌─────────────────┐                      │
│                            │ Gemini Audio    │                      │
│                            │ Analysis (TODO) │                      │
│                            └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Effect Wrappers Required

### VAD Service (Effect-native wrapper for @ricky0123/vad-web)

Need to design an Effect service that wraps @ricky0123/vad-web with:

```typescript
// Proposed API
export class VadService extends Context.Tag("VadService")<
  VadService,
  {
    readonly start: Effect.Effect<void, VadInitFailed>;
    readonly stop: Effect.Effect<void>;
    readonly speechEvents: Stream.Stream<VadEvent>;
  }
>() {}

export type VadEvent =
  | { type: "speech_start" }
  | { type: "speech_end"; audio: Float32Array };

// Implementation would wrap MicVAD callbacks into Effect streams
```

Key considerations:
- VAD library uses callback-based API - need to bridge to Effect streams
- Must handle cleanup properly (stop VAD when stream ends)
- Consider using `Stream.async` or `Queue` for callback bridging

### Transformers.js Service (Effect wrapper for @huggingface/transformers)

Need Effect service wrapping the Transformers.js pipeline:

```typescript
export class TranscriptionService extends Context.Tag("TranscriptionService")<
  TranscriptionService,
  {
    readonly loadModel: (modelId: string) => Effect.Effect<void, ModelLoadFailed>;
    readonly transcribe: (audio: Float32Array, options: TranscribeOptions) =>
      Effect.Effect<TranscriptionResult, TranscriptionFailed>;
    readonly isModelLoaded: Effect.Effect<boolean>;
    readonly modelLoadProgress: Stream.Stream<LoadProgress>;
  }
>() {}
```

Key considerations:
- Model loading is async and can fail - needs proper error handling
- Progress reporting during model download
- Model caching/persistence across sessions (see Open Questions)
- Worker isolation (current pattern should be preserved)

---

## Implementation Priorities

### Phase 1: Immediate (Current Sprint)

1. **Install packages** - `@huggingface/transformers` v3, `@ricky0123/vad-web`
2. **Explore APIs** - Understand actual APIs for Effect wrapper design
3. **Research model caching** - Investigate how Transformers.js handles caching
4. **Design Effect wrappers** - VadService and TranscriptionService interfaces
5. **Fix AudioWorklet buffer copying** (use transferable objects)
6. **Add model preloading** for better UX

### Phase 2: Short-Term

1. **R2 lifecycle rules** for auto-delete
2. **Upload progress indicator** in UI
3. **Error recovery** with Effect retry patterns
4. **Confidence thresholds** for transcription quality

### Phase 3: Future Consideration

1. **TanStack Start migration** (type-safe routing)
2. **Opus compression** (10x smaller uploads)
3. **Parakeet server-side** (if real-time streaming needed)
4. **Pronunciation scoring** (requires audio)

---

## Package Updates

```json
{
  "dependencies": {
    "@huggingface/transformers": "^3.0.0",
    "@ricky0123/vad-web": "^0.0.22",
    "@effect-atom/atom-react": "^0.4.5"
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

## Open Questions

1. **VAD sensitivity tuning** - What threshold works best for language learners?
2. **Model size trade-off** - Should we offer whisper-small for better accuracy?
3. **TanStack migration timing** - Wait for 1.0 or start with RC?

---

## Sources

- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js/index)
- [TanStack Start Overview](https://tanstack.com/start/latest/docs/framework/react/overview)
- [Vercel AI SDK Voice Features](https://ai-sdk.dev/docs/ai-sdk-core/speech)
- [NVIDIA Parakeet Models](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)
- [@ricky0123/vad-web](https://github.com/ricky0123/vad)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
