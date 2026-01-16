# Effect Wiring Guide (Declarative + Robust)

Status: Draft

## Purpose
Provide production-grade wiring guidance for the service graph and runtime boundaries using Effect. This is aligned to the existing code style and Effect APIs.

## Core Effect Primitives (with intent)
- `Context.Tag` is the DI map that binds service interfaces to implementations. Use one tag per boundary. `effect/packages/effect/src/Context.ts:1`
- `Layer` describes how to build services and share them by default. Compose layers to build the full graph. `effect/packages/effect/src/Layer.ts:1`
- `Effect.gen` provides sequential orchestration for effectful programs. `effect/packages/effect/src/Effect.ts:2711`
- `Effect.fn` marks boundary functions with tracing spans and call-site stacks. `effect/packages/effect/src/Effect.ts:14486`
- `Schema.TaggedError` provides structured, yieldable domain errors. `effect/packages/effect/src/Schema.ts:8813`
- `Config` and `ConfigProvider` provide typed configuration loading and test overrides. `effect/packages/effect/src/Config.ts:33`, `effect/packages/effect/src/ConfigProvider.ts:38`

## Service Boundaries in This Repo
Use explicit services for each external or stateful boundary.

Current tags (examples):
- `Env` for Cloudflare bindings. `apps/api/src/services/Env.ts:3`
- `Db` for D1 access. `apps/api/src/services/Db.ts:1`
- `TurnQueue`, `RoomDoClient`, `AudioBucket`. `apps/api/src/services/TurnQueue.ts:1`, `apps/api/src/services/RoomDoClient.ts:1`
- `ScoringService`. `apps/api/src/services/ScoringService.ts:1`
- `ScenarioBuilder`, `VectorStore`, `Ai` for KB + generation. `apps/api/src/services/ScenarioBuilder.ts:1`, `apps/api/src/services/VectorStore.ts:1`, `apps/api/src/services/Ai.ts:1`

## Recommended Layer Graph
Use a single composed "AppLayer" per runtime entrypoint.

Example pattern (existing):
- `makeAppLayer` merges services and provides `Env` + `ScoringConfig`. `apps/api/src/index.ts:29`

Production wiring guidance:
1. `Env` layer comes from Cloudflare bindings or test doubles.
2. `Config` layer provides policy settings (model hosting, scoring weights, auth config).
3. `Db`, `TurnQueue`, `RoomDoClient`, `AudioBucket`, `ScoringService` are wired via `Layer.mergeAll`.
4. Additional components (ScenarioBuilder, VectorStore, Ai) attach to the same base.

References: `effect/packages/effect/src/Layer.ts:1`, `apps/api/src/index.ts:29`

## Handler Pattern
Use `Effect.fn` for HTTP handlers and worker functions so each boundary is traced, and use `Effect.gen` inside for sequencing.

Example shape (pattern, not code):
1. `const submitTurn = Effect.fn("submitTurn")(function* (...) { ... })`
2. Validate with `Schema` and throw `Schema.TaggedError` for domain errors.
3. Compose retries/timeouts on external boundaries.

References: `effect/packages/effect/src/Effect.ts:14486`, `effect/packages/effect/src/Effect.ts:2711`, `effect/packages/effect/src/Schema.ts:8813`

## Error Modeling
Define domain errors with `Schema.TaggedError` and map them at the boundary (HTTP response or queue dead-letter).

This makes errors serializable and pattern-matchable. `effect/packages/effect/src/Schema.ts:8813`, `apps/api/src/http/errorResponse.ts:1`

## Config Strategy
Create a config service tagged with `Context.Tag` and load config with `Config` primitives.

Use `ConfigProvider` in tests to avoid environment mutation. `effect/packages/effect/src/Config.ts:33`, `effect/packages/effect/src/ConfigProvider.ts:38`

## Runtime Boundaries
The API worker uses `Effect.runPromise` in `fetch` and `queue`. Treat these as the boundary where defects are logged and responses are mapped. `apps/api/src/index.ts:82`

## Testing Approach
Replace services via `Layer.succeed` or provide test doubles for `Db`, `TurnQueue`, and `RoomDoClient`. The existing tests already follow this pattern. `apps/api/src/http/__tests__/turns.test.ts:1`

