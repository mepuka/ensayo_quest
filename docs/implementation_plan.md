# Implementation Plan (Near Production)

Status: Draft (detailed engineering plan)

## Goal
Wire the current codebase into an end-to-end, production-ready flow with local ASR, room orchestration, scoring, and real-time updates. All work items below reference the current codebase and Effect patterns.

## Phase 0 - Lock Decisions
1. Scenario source policy (D1 seed only vs AI fallback). `apps/api/src/http/handlers.ts:36`
2. Model hosting policy for Transformers.js (remote vs self-host). `node_modules/@xenova/transformers/src/env.js:66`
3. Identity model (anonymous vs authenticated users). `apps/api/src/http/handlers.ts:75`
4. LLM provider/model (Gemini 3 class, low temperature). `docs/language_review_module_spec.md:1`

Deliverable: Written decisions in `docs/production_wiring_spec.md`.

## Phase 1 - Infra + Config
### 1.1 Wrangler bindings
- Add queue consumer binding for turn scoring so `queue()` runs in prod. `apps/api/wrangler.toml:17`, `apps/api/src/index.ts:161`
- Confirm DO binding is consistent. `apps/api/wrangler.toml:21`

### 1.2 D1 seed for scenario templates
- Seed data uses Effect-native ScenarioTemplate instances. `apps/api/src/seed/SeedData.ts:1`
- CI generates SQL from SeedData via `apps/api/scripts/generate-seed-sql.ts`
- All 16 scenarios (4 topics × 4 levels) are validated at generation time.

### 1.3 Config service
- Introduce a config tag for runtime policy (model hosting, scoring weights, Turnstile settings).
- Use `Config` and `ConfigProvider` to load from env and override in tests. `effect/packages/effect/src/Config.ts:33`, `effect/packages/effect/src/ConfigProvider.ts:38`

Acceptance criteria:
- Queue consumer is active in production and scores turns.
- Scenario creation works without manual DB edits.

## Phase 2 - Backend Wiring
### 2.1 ScenarioBuilder fallback
- If `findScenarioTemplate` fails, call ScenarioBuilder and persist new template. `apps/api/src/services/ScenarioBuilder.ts:18`, `apps/api/src/http/handlers.ts:36`
- Implement Live `Ai` and `VectorStore` layers (Workers AI + Vectorize). `apps/api/src/services/Ai.ts:1`, `apps/api/src/services/VectorStore.ts:1`

### 2.2 Language review module (LLM)
- Implement LanguageReview service + config based on `docs/language_review_module_spec.md`.
- Use `LanguageModel.generateObject` for structured output and Gemini 3 provider layer. `node_modules/@effect/ai/src/LanguageModel.ts:913`, `node_modules/@effect/ai-google/src/GoogleLanguageModel.ts:245`

### 2.3 Scoring output completeness
- Extend ScoringService to return `feedback`, `nextPrompt`, and `confidence`. `apps/api/src/services/ScoringService.ts:83`, `apps/shared/src/RoomProtocol.ts:4`
- Keep deterministic scoring, add LLM review results when available.

### 2.4 Room DO state snapshots
- Use `RoomEventEnvelope.stateJson` to persist state in DO storage. `apps/shared/src/RoomProtocol.ts:68`, `apps/api/src/durable-objects/RoomDurableObject.ts:28`
- Consider using `RoomState` to drive scenario progression. `apps/api/src/domain/RoomState.ts:58`

### 2.5 Error handling
- Model domain errors with `Schema.TaggedError` and map to HTTP and queue boundaries. `effect/packages/effect/src/Schema.ts:8813`, `apps/api/src/http/errorResponse.ts:1`

Acceptance criteria:
- Scoring updates always include `nextPrompt` and visible feedback.
- Room DO persists a snapshot and can recover state after restart.

## Phase 3 - Frontend Wiring
### 3.1 Room creation and turn submission UI
- Add UI action to call `POST /api/rooms` and store `roomId`/`wsUrl`. `apps/api/src/index.ts:82`
- On ASR stop, compute `audioFeatures` and submit `HttpTurnSubmission`. `apps/api/src/domain/HttpProtocol.ts:25`
- Display seed prompt and `ScoreUpdated` content. `apps/shared/src/RoomProtocol.ts:4`

### 3.2 Production build for ASR worker and worklet
- Promote the dev build flow to a production asset build step. `apps/web/dev.ts:10`
- Ensure `asrWorker.js` and `audioProcessor.js` are served in production.

Acceptance criteria:
- A user can create a room, record speech, submit a turn, and see scoring update.

## Phase 4 - ASR Quality and Model Hosting
### 4.1 Sample rate alignment
- Resample audio to the model sampling rate or capture at the correct rate.
- Transformers.js uses the processor sampling rate during audio prep. `node_modules/@xenova/transformers/src/pipelines.js:1705`

### 4.2 Model hosting
- Decide if models are self-hosted. If yes, set `env.localModelPath` and disable remote models, and host WASM files. `node_modules/@xenova/transformers/README.md:136`, `node_modules/@xenova/transformers/src/env.js:66`
- Pass `language` and `task` to Whisper inference for Spanish. `node_modules/@xenova/transformers/src/pipelines.js:1728`

Acceptance criteria:
- Stable transcription quality across supported browsers.

## Phase 5 - Integration Testing
### 5.1 Backend integration tests
- Test room creation -> turn submission -> scoring consumer -> score update event.
- Use test layers via `Layer.succeed` and effect test patterns. `apps/api/src/http/__tests__/turns.test.ts:1`

### 5.2 Frontend integration checks
- Verify worker assets load, ASR produces transcript, and turn submission succeeds.
- Validate `ScoreUpdated` updates UI via event stream. `apps/web/eventlog/EventLogClient.ts:34`

Acceptance criteria:
- Single script can run local E2E flow without manual DB changes.

## Definition of Done
- Room creation works for seeded and AI-generated templates.
- Turn submission triggers queue scoring and emits `ScoreUpdated`.
- Frontend shows seed prompt, transcription, score, and next prompt.
- ASR model hosting and caching behavior is defined and documented.
