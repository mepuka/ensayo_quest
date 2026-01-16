# Frontend Voice Stack Design

**Date**: 2026-01-16
**Issue**: ensayo_quest-k7e (Research frontend stack for voice/audio pipeline)
**Status**: Research Complete

---

## Executive Summary

This document compiles research findings from six parallel investigations into modernizing Ensayo Quest's frontend voice/audio pipeline. The recommendation is a **hybrid architecture** with:

1. **Client-side ASR**: Whisper via Transformers.js (current approach, validated)
2. **Frontend Framework**: TanStack Start for type-safe routing and server functions
3. **Voice Activity Detection**: @ricky0123/vad-web for smarter recording triggers
4. **Audio Upload**: Keep current hybrid pattern (client transcribe + optional R2 backup)

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

### Current Flow (Validated)

```
Browser                           API
-------                           ---
1. AudioWorklet capture
2. Whisper transcription (local)
3. POST /api/rooms/:roomId/turns  →  Insert turn, enqueue scoring
4. Receive turnId                 ←
5. POST /api/turns/:turnId/audio  →  Store in R2
```

### Cost Analysis

| Component | Free Tier | At Scale (500K turns/day) |
|-----------|-----------|---------------------------|
| R2 Storage | 10GB/mo | ~$113/mo (30-day retention) |
| R2 PUT ops | 1M/mo | ~$63/mo |
| Workers AI Whisper | - | **~$33K/day** (not recommended) |

### Recommendation

**Keep hybrid approach**:
- Client transcription for immediate feedback
- Optional audio upload for: QA sampling, pronunciation features, model improvement
- **Do not** re-transcribe every turn server-side (cost prohibitive)

### Future Enhancements

1. Add R2 lifecycle rules for auto-delete after 30 days
2. Consider presigned URLs for direct-to-R2 upload at scale
3. Compress to Opus (10x smaller) when ready

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
│  │ 2. [Opt-in] POST /api/turns/:turnId/audio (WAV)                ││
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
│                            │ (optional store)│                      │
│                            └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Priorities

### Phase 1: Immediate (Current Sprint)

1. **Update Transformers.js** to `@huggingface/transformers` v3
2. **Add VAD integration** with `@ricky0123/vad-web`
3. **Fix AudioWorklet buffer copying** (use transferable objects)
4. **Add model preloading** for better UX

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
