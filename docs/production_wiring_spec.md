# Production Wiring Spec - Ensayo Quest

Status: Draft (implementation guidance, near-production)

## Purpose
Define the production wiring plan, end-to-end data flow, and integration contracts for the Ensayo Quest MVP. This spec is aligned to the current codebase and Effect patterns, with clear decision points and implementation guidance.

## Scope
- Browser app (React UI, local ASR worker, audio capture)
- API Worker (HTTP routes)
- Durable Objects (room event log and state)
- Queue consumer (turn scoring)
- D1, R2, Vectorize, Workers AI bindings

References: `apps/api/src/index.ts:82`, `apps/api/src/services/Env.ts:3`

## Decisions To Lock (TBD)
These must be confirmed before final implementation.

| Decision | Options | Recommendation | Status |
| --- | --- | --- | --- |
| Scenario templates source | D1 seed only vs D1 seed + AI fallback | Seed D1, fallback to ScenarioBuilder when missing | TBD |
| Model hosting (Transformers.js) | Remote HF + CDN vs self-hosted | Self-host for production, remote for dev | TBD |
| Audio policy | Transcript-only vs transcript + optional audio | Transcript-only + optional audio | Locked (no extra complexity) |
| Identity | Anonymous vs authenticated | Authenticated identity with roles | TBD |
| LLM provider/model | Google Gemini 3 class | Gemini 3 class, low temperature | Locked |

References: `apps/api/src/http/handlers.ts:36`, `apps/api/src/seed/SeedData.ts:1`, `apps/api/src/services/ScenarioBuilder.ts:18`, `node_modules/@xenova/transformers/src/env.js:66`, `apps/api/src/services/LanguageReview.ts:79`

## Architecture Overview

### Components
- Browser: React UI, ASR worker using Transformers.js, audio capture via AudioWorklet. `apps/web/asr/worklet/WorkletCapture.ts:35`, `apps/web/asr/worker/asrWorker.ts:16`
- API Worker: HTTP routes for room creation, turn submission, audio upload, and WS pass-through. `apps/api/src/index.ts:82`
- Room DO: EventLog Durable Object handling room event stream. `apps/api/src/durable-objects/RoomDurableObject.ts:28`
- Turn Queue + Consumer: Queue messages processed for scoring and event emission. `apps/api/src/index.ts:161`, `apps/api/src/workers/TurnScoringConsumer.ts:22`
- Storage: D1 for room/turns/scores, R2 for audio, Vectorize for KB, AI binding for LLMs. `apps/api/src/services/Env.ts:3`

### Service Graph (Effect)
Use `Context.Tag` services and `Layer` composition to produce all runtime dependencies declaratively. `effect/packages/effect/src/Context.ts:1`, `effect/packages/effect/src/Layer.ts:1`

### Architecture Diagram (ASCII)
```
[Browser UI + ASR Worker]
  | local ASR -> transcript + audioFeatures
  | POST /api/rooms, /api/rooms/:id/turns, /api/turns/:id/audio
  v
[API Worker] ---------------------> [R2 Audio Bucket]
  | create room -> [D1]
  | enqueue turn -> [TURN_QUEUE] -> [TurnScoringConsumer] -> [ScoringService] -> [D1 turn_scores]
  | emit ScoreUpdated -> [Room DO / EventLog] -> WS -> [Browser UI]
```

## End-to-End Data Flow

### 1) Create Room
1. Client calls `POST /api/rooms` with topic/level/mode. `apps/api/src/domain/HttpProtocol.ts:3`
2. API selects a scenario template from D1 and creates a room. `apps/api/src/http/handlers.ts:36`
3. API returns `roomId`, `wsUrl`, `seedPrompt`. `apps/api/src/index.ts:89`, `apps/api/src/domain/HttpProtocol.ts:9`

### 2) Capture + Local ASR
1. Browser captures audio with AudioWorklet and buffers Float32 samples. `apps/web/asr/worklet/WorkletCapture.ts:35`
2. ASR worker runs Transformers.js `automatic-speech-recognition`. `apps/web/asr/worker/asrWorker.ts:16`
3. Ensure audio is resampled to the model sampling rate before inference. Transformers.js reads the processor sampling rate during preparation. `node_modules/@xenova/transformers/src/pipelines.js:1705`

### 3) Submit Turn
1. Client sends `POST /api/rooms/:id/turns` with transcript + audioFeatures. `apps/api/src/index.ts:99`, `apps/api/src/domain/HttpProtocol.ts:25`
2. API validates input, inserts turn, enqueues a scoring job, emits `TurnAccepted`. `apps/api/src/http/handlers.ts:52`, `apps/shared/src/RoomProtocol.ts:35`

### 4) Score Turn (Queue Consumer)
1. Queue consumer loads submission + template, evaluates, writes `turn_scores`, emits `ScoreUpdated`. `apps/api/src/workers/TurnScoringConsumer.ts:22`
2. Emitted `ScoreUpdated` includes `TurnEvaluation` with `nextPrompt`, `scores`, and `feedback` for UI progression. `apps/shared/src/RoomProtocol.ts:4`

### 5) Client Updates
1. Client subscribes to room event stream via WS in EventLogRemote. `apps/web/eventlog/EventLogClient.ts:34`
2. UI reacts to `TurnAccepted` and `ScoreUpdated`. `apps/web/eventlog/RoomEventReducer.ts:17`

## Contracts

### HTTP
- `POST /api/rooms`: `CreateRoomRequest` -> `CreateRoomResponse`. `apps/api/src/domain/HttpProtocol.ts:3`
- `POST /api/rooms/:id/turns`: `HttpTurnSubmission` -> `{ turnId, status }`. `apps/api/src/domain/HttpProtocol.ts:25`, `apps/api/src/index.ts:99`
- `POST /api/turns/:id/audio`: raw audio -> `TurnAudioResponse`. `apps/api/src/domain/HttpProtocol.ts:15`
- `GET /api/rooms/:id/stream`: EventLogRemote WS pass-through. `apps/api/src/index.ts:115`

### Queue
- `QueueJob` shape: `{ roomId, turnId, status }`. `apps/api/src/domain/QueueJob.ts:1`

### Room Events
- `RoomEventSchema`: `RoomSnapshot`, `TurnAccepted`, `ScoreUpdated`, `RoomCompleted`, `RoomError`. `apps/shared/src/RoomProtocol.ts:25`
- `RoomEventEnvelope` supports optional `stateJson` for snapshot persistence. `apps/shared/src/RoomProtocol.ts:68`

## ASR + Transformers.js Production Settings
- Default Transformers.js loads models from HF and WASM from CDN; configure `env.localModelPath`, `env.allowRemoteModels`, and `env.backends.onnx.wasm.wasmPaths` for production hosting. `node_modules/@xenova/transformers/README.md:136`, `node_modules/@xenova/transformers/src/env.js:66`
- For Whisper, pass `language` and `task` to lock Spanish transcription and avoid auto detection. `node_modules/@xenova/transformers/src/pipelines.js:1728`
- Resample or capture at model sampling rate (Whisper uses processor sampling rate). `node_modules/@xenova/transformers/src/pipelines.js:1705`

## Room State + Event Log
- Room DO uses EventLogDurableObject and stores room event entries. `apps/api/src/durable-objects/RoomDurableObject.ts:28`
- Emitted events are serialized with MsgPack and decoded client-side. `apps/shared/src/RoomProtocol.ts:77`, `apps/web/eventlog/EventLogClient.ts:27`
- Use `RoomEventEnvelope.stateJson` to persist snapshot state alongside event append. `apps/shared/src/RoomProtocol.ts:68`

## Scoring Requirements
- Scoring must produce non-empty `feedback` and `nextPrompt` so UI can advance. `apps/shared/src/RoomProtocol.ts:4`
- ScoringService now fills feedback/nextPrompt when the LanguageReview module is provided, and falls back deterministically when it is not. `apps/api/src/services/ScoringService.ts:81`

## Language Review Module (LLM)
- The LLM prompting module is specified in `docs/language_review_module_spec.md`.
- It uses `LanguageModel.generateObject` for structured outputs and is provider-agnostic. `node_modules/@effect/ai/src/LanguageModel.ts:913`
- Google Gemini is wired via `@effect/ai-google` layers. `node_modules/@effect/ai-google/src/GoogleLanguageModel.ts:245`
- Default config targets Gemini 3 class models with low temperature. `apps/api/src/services/LanguageReview.ts:79`

## Observability and Reliability (Effect)
- Use `Effect.gen` for sequential composition and `Effect.fn` at handler boundaries to get spans and call-site traces. `effect/packages/effect/src/Effect.ts:2711`, `effect/packages/effect/src/Effect.ts:14486`
- Model domain errors with `Schema.TaggedError` for typed, serializable errors. `effect/packages/effect/src/Schema.ts:8813`
- Layer composition gives shared resources and deterministic wiring. `effect/packages/effect/src/Layer.ts:1`

## Deployment Wiring
- Wrangler must bind a queue consumer in addition to the producer for scoring. `apps/api/wrangler.toml:17`
- Ensure DO binding for `RoomDurableObject` remains consistent. `apps/api/wrangler.toml:21`
- Bind D1, R2, Vectorize, and AI for runtime services. `apps/api/src/services/Env.ts:3`
- Provide `GOOGLE_AI_API_KEY` (and optional `GOOGLE_AI_API_URL`) for Gemini access; runtime will fail without it. `apps/api/src/services/LanguageReviewGoogle.ts:20`, `apps/api/src/index.ts:29`

## Risks and Mitigations
- Missing templates in D1 will 404 on room creation. Mitigate via seed or ScenarioBuilder fallback. `apps/api/src/http/handlers.ts:36`
- ASR accuracy will degrade without sample-rate alignment. Mitigate via resampling in worker. `node_modules/@xenova/transformers/src/pipelines.js:1705`
- Event stream can be decrypted by anyone who knows roomId if no auth is added. Mitigate via auth or per-room secret. `apps/web/eventlog/EventLogClient.ts:10`
