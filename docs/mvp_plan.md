# Ensayo Quest MVP Spec (Effect + Cloudflare)

## 0. Scope

### Goals
- Ship a Solo vs NPC speaking practice loop with per-turn feedback.
- Use Effect-native services, schemas, and layers for type-safe wiring.
- Run backend on Cloudflare (Worker + Durable Objects + D1 + Queues).
- Deliver a lightweight web UI with local ASR, VAD, and responsive feedback.

### Non-goals (MVP)
- Async Duo and real-time multiplayer.
- Server-side ASR or audio re-verification.
- TTS for NPC lines.
- Full content authoring tools.
- Knowledge base retrieval for scenario generation.

### MVP constraints
- Spanish-only scenarios.
- No transcript editing before submission.
- Scenario completion is objective-based (no fixed turn limit).

## 1. Architecture Overview

### Cloudflare components
- Worker API: HTTP endpoints and queue consumer.
- Durable Objects: per-room WebSocket state and fan-out.
- D1: persistent room state, turns, evaluations, scenarios.
- Queues: async scoring pipeline.
- R2: audio blob storage.
- Vectorize (later): knowledge retrieval for prompts.
- Pages: static frontend hosting.

### Runtime and tooling
- Effect for composition and dependency injection.
- Bun for local dev, scripts, and tests.
- HTML imports for frontend bundling where possible.

## 2. Effect-native Design

### Principles
- Use `Effect.gen` for effectful control flow.
- Use `Effect.fn` for traced entrypoints and spans (turn scoring, prompt generation).
- Model domain errors with `Schema.TaggedError`.
- Define all boundary I/O with `Schema` and decode/validate at edges.
- Use `Effect.Service` + `Layer` for clean dependency graphs.

### Service layout (initial MVP)
- `ScenarioRepo`: list and fetch scenario templates.
- `RoomRepo`: create, load, update room state in D1.
- `TurnRepo`: create turn, mark scored, fetch history.
- `KnowledgeBase`: retrieve scenario context (seeded or Vectorize).
- `ScoringService`: compute per-turn evaluation.
- `PromptService`: generate next NPC prompt.
- `RoomNotifier`: notify DO of updates.
- `QueueClient`: enqueue scoring jobs.
- `IdGenerator`, `Clock`, `Config`, `Logger` as shared services.

### Layer wiring
- `D1ClientLive`: scoped D1 client layer (Cloudflare binding).
- `QueueLive`, `R2Live`, `VectorizeLive`: runtime bindings.
- `ScenarioRepoLive` depends on `D1Client`.
- `ScoringServiceLive` depends on `KnowledgeBase`, `Logger`, `Config`.
- Provide a single composed `AppLive` layer at process entry.

## 3. API and Protocol

### HTTP endpoints
- `POST /rooms`: create room and return `roomId`, initial prompt, `wsUrl`.
- `POST /turns`: submit a turn (non-WS fallback).
- `POST /turns/:id/audio`: upload audio and return `audioKey`.
- `POST /rooms/:id/notify-score`: internal hook from queue consumer to DO.

### WebSocket protocol
Client -> Server:
- `JoinRoom`: `{ type, roomId, lastEventId? }`
- `SubmitTurn`: `{ type, turnId, transcript, audioFeatures, clientTimestamp }`
- `Ping`: `{ type, ts }`

Server -> Client:
- `RoomSnapshot`: `{ type, roomState, lastEventId }`
- `TurnAccepted`: `{ type, turnId }`
- `ScoreUpdated`: `{ type, turnId, evaluation }`
- `RoomCompleted`: `{ type, summary }`
- `Error`: `{ type, code, message, retryable }`

### Ordering and idempotency
- Every event includes `eventId` and `sequence`.
- `turnId` is idempotent, unique per room.
- DO rejects duplicate `turnId` submissions.

## 4. Data Models and Schemas

### ScenarioTemplate
```ts
interface ScenarioTemplate {
  id: string;
  language: string;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  topic: string;
  roles: { user: string; npc: string };
  objectives: Array<string>;
  seedPrompt: string;
  knowledgeRefs?: Array<string>;
}
```

### RoomState
```ts
interface RoomState {
  roomId: string;
  scenarioId: string;
  status: "playing" | "completed";
  currentTurnIndex: number;
  objectivesCompleted: number;
  history: Array<{
    turnId: string;
    role: "user" | "npc";
    text: string;
    score?: TurnEvaluation;
  }>;
}
```

### TurnSubmission
```ts
interface TurnSubmission {
  roomId: string;
  turnId: string;
  transcript: string;
  language: string;
  clientTimestamp: number;
  audioFeatures: {
    durationMs: number;
    pauseCount: number;
    speakingRateWpm: number;
  };
  audioKey?: string;
  asrSource?: string;
}
```

### TurnEvaluation
```ts
interface TurnEvaluation {
  turnId: string;
  scores: {
    fluency: number;
    vocab: number;
    naturalness: number;
  };
  overallScore: number;
  feedback: Array<string>;
  nextPrompt: string;
  modelVersion: string;
  confidence: number;
}
```

## 5. Data Flows

### Create Room
1. Client calls `POST /rooms` with `topic`, `level`, `mode`.
2. Worker selects a `ScenarioTemplate` and creates `RoomState`.
3. Persist room and initial history in D1.
4. Return `roomId`, `wsUrl`, `seedPrompt`.

### Join Room
1. Client opens WS to DO and sends `JoinRoom`.
2. DO loads `RoomState` from D1 if not cached.
3. DO sends `RoomSnapshot`.

### Submit Turn
1. Client sends `SubmitTurn` over WS.
2. DO validates schema, persists `TurnSubmission` in D1.
3. DO enqueues scoring job and responds with `TurnAccepted`.

### Upload Audio
1. Client posts audio blob to `POST /turns/:id/audio`.
2. Worker stores audio in R2 at `roomId/turnId`.
3. Response includes `audioKey`, referenced by `TurnSubmission`.

### Scoring Pipeline
1. Queue consumer loads `TurnSubmission`, `RoomState`, and scenario context.
2. Compute deterministic metrics from `audioFeatures`.
3. Call LLM for rubric scoring and next prompt.
4. Validate LLM output with `Schema` and merge results.
5. Persist `TurnEvaluation` and update `RoomState`.
6. Notify DO to broadcast `ScoreUpdated`.

### Completion
1. DO checks objectives for completion (no fixed turn limit).
2. Update `RoomState.status` and aggregate summary.
3. Broadcast `RoomCompleted`.

### Reconnect and Resume
1. Client reconnects with `lastEventId`.
2. DO replays missed events or sends a fresh `RoomSnapshot`.

## 6. Scoring (MVP)

### Deterministic metrics
- `fluency` derived from speaking rate and pause count.
- Map to a 1-5 scale using a simple clamp and linear scaling.

### LLM rubric
- Input: transcript, scenario context, objectives, role and turn history.
- Output: JSON that matches `TurnEvaluation` (schema validated).
- If invalid, retry with a stricter prompt; fallback to deterministic-only.

### Rollup
- `overallScore = 0.4 * fluency + 0.3 * vocab + 0.3 * naturalness`.
- Summary screen uses mean overall score per room.

## 7. Knowledge Base and Seeding

### Initial seeding
- Seed D1 with 5 `ScenarioTemplate` entries for Spanish daily tasks.
- Keep seed data in a checked-in JSON file and a Bun seed script.
- Scenario details can be expanded at room creation via LLM prompt.

### Retrieval (post-MVP)
- Store knowledge articles in R2 with metadata (topic, level).
- Precompute embeddings and index in Vectorize.
- At room creation, retrieve top K chunks for prompt grounding.

## 8. Storage and Persistence

### D1 tables (minimum)
- `scenarios`: templates and metadata.
- `rooms`: room state snapshot and status.
- `turns`: user submissions.
- `evaluations`: per-turn scores.
- `events`: event log for replay and debugging.

### Constraints and indexes
- Unique `(roomId, turnId)` in `turns`.
- Index `rooms.status` for cleanup and analytics.
- Index `evaluations.turnId` for joins.

### Retention
- Default keep transcripts and scores for 30 days.
- Audio stored in R2; retention policy to be defined.

## 9. Observability
- Use `Effect.fn` for key pipelines to create spans.
- `Effect.annotateLogs` with `roomId`, `turnId`, `scenarioId`.
- Track queue latency, scoring latency, and error rate.

## 10. Security and Privacy
- Validate all client input with `Schema.decode`.
- Basic rate limits per IP and per room.
- Audio stored in R2; limit access and avoid sharing by default.
- Redact logs of full transcript if privacy policy requires it.

## 11. Testing
- `@effect/vitest` for service tests and schema validation.
- Scoring tests with golden inputs and deterministic outputs.
- DO integration test: join, submit, score, complete.

## 12. Immediate Implementation Plan
1. Define schemas and domain errors.
2. Implement D1 schema and seed data.
3. Build DO for WS protocol and room state.
4. Add R2 audio upload endpoint and storage plumbing.
5. Build queue consumer for scoring.
6. Wire frontend to protocol and render loop.

## 13. Open Questions
- How to weight scoring dimensions, and is a single overall score sufficient?
- What is the audio retention policy and deletion workflow?
