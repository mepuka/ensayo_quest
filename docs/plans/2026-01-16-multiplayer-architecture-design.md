# Multiplayer Architecture Design

> Design document for Effect-native multiplayer state management in Ensayo Quest.
> Created: 2026-01-16

## Overview

This design introduces multiplayer support with:
- Dynamic turn-taking based on scenario rubrics (not strict A-B-A-B)
- Mixed participants: human players + generated NPCs
- Full event replay on reconnection
- Auto-push NPC turns after 2-second delay
- Future extensibility for dynamic character injection

## Core Abstractions

### Effect Patterns Used

| Pattern | API | Purpose |
|---------|-----|---------|
| **Machine** | `@effect/experimental/Machine` | Type-safe actor with request handlers |
| **ProcedureList** | `Machine/ProcedureList` | Register handlers by `_tag` |
| **Subscribable** | `effect/Subscribable` | Reactive state with `changes` stream |
| **SynchronizedRef** | `effect/SynchronizedRef` | Atomic state modifications |
| **EventJournal** | `@effect/experimental/EventJournal` | Event replay for reconnection |
| **Schema.TaggedRequest** | `effect/Schema` | Type-safe request/response definitions |

### Cloudflare Patterns Used

| Pattern | Purpose |
|---------|---------|
| **Hibernatable WebSockets** | Zero billing when idle |
| **WebSocket attachments** | Store player context on connection |
| **DO alarms** | NPC turn timing survives hibernation |
| **blockConcurrencyWhile** | Schema + state loaded before requests |

---

## Data Model

### Participant Types

```typescript
const ParticipantType = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Player"), playerId: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("NPC"), npcId: Schema.String, role: Schema.String })
);
```

### Turn Plan (from Scenario Rubric)

```typescript
const TurnPlanStep = Schema.Struct({
  stepIndex: Schema.Number,
  participant: ParticipantType,
  context: Schema.optional(Schema.String),
  expectedAction: Schema.optional(Schema.String)
});

const TurnPlan = Schema.Struct({
  roomId: Schema.String,
  steps: Schema.Array(TurnPlanStep),
  currentStepIndex: Schema.Number,
  dynamicExtensionAllowed: Schema.Boolean
});
```

### Room State

```typescript
const MultiplayerRoomState = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("AwaitingTurn"),
    participant: ParticipantType,
    stepIndex: Schema.Number
  }),
  Schema.Struct({
    _tag: Schema.Literal("Processing"),
    turnId: Schema.String,
    participant: ParticipantType
  }),
  Schema.Struct({
    _tag: Schema.Literal("NpcPending"),
    npcId: Schema.String,
    scheduledAt: Schema.Number
  }),
  Schema.Struct({ _tag: Schema.Literal("Complete") })
);
```

---

## Request Types (TaggedRequests)

```typescript
// PUBLIC: Player joins room
class PlayerJoin extends Schema.TaggedRequest<PlayerJoin>()(
  "PlayerJoin",
  { failure: Schema.String, success: Schema.Void },
  { playerId: Schema.String }
) {}

// PUBLIC: Player submits turn
class SubmitTurn extends Schema.TaggedRequest<SubmitTurn>()(
  "SubmitTurn",
  { failure: Schema.String, success: Schema.Struct({ turnId: Schema.String }) },
  { playerId: Schema.String, transcript: Schema.String, audioFeatures: AudioFeatures }
) {}

// PRIVATE: Generate NPC turn
class GenerateNpcTurn extends Schema.TaggedRequest<GenerateNpcTurn>()(
  "GenerateNpcTurn",
  { failure: Schema.String, success: Schema.Void },
  { npcId: Schema.String, stepIndex: Schema.Number }
) {}

// PRIVATE: Advance to next step
class AdvanceStep extends Schema.TaggedRequest<AdvanceStep>()(
  "AdvanceStep",
  { failure: Schema.Never, success: Schema.Void },
  { completedStepIndex: Schema.Number }
) {}

// PUBLIC: Get current state
class GetState extends Schema.TaggedRequest<GetState>()(
  "GetState",
  { failure: Schema.Never, success: RoomStateSchema },
  {}
) {}
```

---

## Room Machine

```typescript
const RoomMachine = Machine.make((input: { roomId: string; turnPlan: TurnPlan }) =>
  ProcedureList.make<MultiplayerRoomState>(
    { _tag: "AwaitingTurn", participant: input.turnPlan.steps[0].participant, stepIndex: 0 },
    { identifier: `Room:${input.roomId}` }
  ).pipe(
    // PUBLIC: Player joins
    ProcedureList.add<PlayerJoin>()("PlayerJoin", (ctx) =>
      Effect.gen(function* () {
        const newState = addPlayerToState(ctx.state, ctx.request.playerId);
        yield* emitEvent({ type: "PlayerJoined", playerId: ctx.request.playerId, timestamp: Date.now() });
        return [void 0, newState];
      })
    ),

    // PUBLIC: Submit turn
    ProcedureList.add<SubmitTurn>()("SubmitTurn", (ctx) =>
      Effect.gen(function* () {
        // Validate it's this player's turn
        if (ctx.state._tag !== "AwaitingTurn") {
          return yield* Effect.fail("not_awaiting_turn");
        }
        if (ctx.state.participant._tag !== "Player" ||
            ctx.state.participant.playerId !== ctx.request.playerId) {
          return yield* Effect.fail("not_your_turn");
        }

        const turnId = yield* generateTurnId;

        // Fork scoring work
        yield* ctx.fork(
          scoreTurn(turnId, ctx.request.transcript, ctx.request.audioFeatures).pipe(
            Effect.flatMap(() => ctx.send(new AdvanceStep({ completedStepIndex: ctx.state.stepIndex })))
          )
        );

        yield* emitEvent({ type: "TurnAccepted", turnId, playerId: ctx.request.playerId });

        return [{ turnId }, { _tag: "Processing", turnId, participant: ctx.state.participant }];
      })
    ),

    // PRIVATE: Generate NPC turn
    ProcedureList.addPrivate<GenerateNpcTurn>()("GenerateNpcTurn", (ctx) =>
      Effect.gen(function* () {
        const npcContent = yield* generateNpcDialogue(ctx.request.npcId, ctx.state);
        const turnId = yield* generateTurnId;

        yield* emitEvent({ type: "NpcTurnGenerated", npcId: ctx.request.npcId, content: npcContent, turnId, stepIndex: ctx.request.stepIndex });
        yield* ctx.send(new AdvanceStep({ completedStepIndex: ctx.request.stepIndex }));

        return [void 0, ctx.state];
      })
    ),

    // PRIVATE: Advance step
    ProcedureList.addPrivate<AdvanceStep>()("AdvanceStep", (ctx) =>
      Effect.gen(function* () {
        const turnPlan = yield* getTurnPlan;
        const nextIndex = ctx.request.completedStepIndex + 1;

        if (nextIndex >= turnPlan.steps.length) {
          yield* emitEvent({ type: "ScenarioComplete" });
          return [void 0, { _tag: "Complete" }];
        }

        const nextStep = turnPlan.steps[nextIndex];

        if (nextStep.participant._tag === "NPC") {
          // Schedule NPC via DO alarm (survives hibernation)
          yield* scheduleNpcAlarm(nextStep.participant.npcId, nextIndex, 2000);
          return [void 0, { _tag: "NpcPending", npcId: nextStep.participant.npcId, scheduledAt: Date.now() }];
        }

        yield* emitEvent({ type: "TurnAdvanced", fromStep: ctx.request.completedStepIndex, toStep: nextIndex, nextParticipant: nextStep.participant });
        return [void 0, { _tag: "AwaitingTurn", participant: nextStep.participant, stepIndex: nextIndex }];
      })
    ),

    // PUBLIC: Get state
    ProcedureList.add<GetState>()("GetState", (ctx) =>
      Effect.succeed([ctx.state, ctx.state])
    )
  )
);
```

---

## Durable Object Integration

```typescript
export class RoomDurableObject extends EventLogDurableObject {
  private actor: Machine.Actor<typeof RoomMachine> | null = null;

  constructor(state: DurableObjectState, env: CloudflareEnv) {
    super({ ctx: state, env, storageLayer: makeStorageLayer(state) });

    state.blockConcurrencyWhile(async () => {
      // Load/restore actor
      const roomId = this.extractRoomId(state);
      const turnPlan = await this.runtime.runPromise(loadTurnPlan(roomId));
      const savedState = await this.runtime.runPromise(loadRoomState(roomId));

      const machine = savedState
        ? ProcedureList.withInitialState(RoomMachine({ roomId, turnPlan }), savedState)
        : RoomMachine({ roomId, turnPlan });

      this.actor = await this.runtime.runPromise(Machine.boot(machine));

      // Subscribe to changes -> persist + broadcast
      this.runtime.runFork(
        Stream.runForEach(this.actor.changes, (newState) =>
          Effect.all([
            persistRoomState(roomId, newState),
            this.broadcastStateUpdate(newState)
          ])
        )
      );
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = decodeIncomingMessage(message);
    const { playerId } = ws.deserializeAttachment();

    const result = await this.runtime.runPromise(
      Match.value(data.type).pipe(
        Match.when("submit_turn", () =>
          this.actor!.send(new SubmitTurn({ playerId, transcript: data.transcript, audioFeatures: data.audioFeatures }))
        ),
        Match.when("get_state", () => this.actor!.send(new GetState({}))),
        Match.orElse(() => Effect.succeed({ error: "unknown_message_type" }))
      ).pipe(Effect.catchAll((e) => Effect.succeed({ error: String(e) })))
    );

    ws.send(JSON.stringify(result));
  }

  async webSocketOpen(ws: WebSocket) {
    const playerId = this.extractPlayerId(ws);
    ws.serializeAttachment({ playerId, connectedAt: Date.now() });

    await this.runtime.runPromise(this.actor!.send(new PlayerJoin({ playerId })));

    // Send replay
    const events = await this.runtime.runPromise(getEventHistory(this.roomId));
    ws.send(JSON.stringify({ type: "replay", events }));
  }

  async alarm() {
    const pending = await this.runtime.runPromise(loadPendingNpc());
    if (pending) {
      await this.runtime.runPromise(
        this.actor!.send(new GenerateNpcTurn({ npcId: pending.npcId, stepIndex: pending.stepIndex }))
      );
    }
  }
}
```

---

## Client Architecture

### Room Client with Replay

```typescript
const makeRoomClient = (options: { roomId: string; playerId: string }) =>
  Effect.gen(function* () {
    const eventStream = yield* makeRoomEventStream({ roomId: options.roomId, url: getRoomStreamUrl(options.roomId) });
    const stateRef = yield* SynchronizedRef.make<ClientRoomState>(initialState(options.playerId));

    yield* Effect.forkScoped(
      Stream.runForEach(eventStream, (event) =>
        stateRef.modify((state) => [void 0, applyEvent(state, event)])
      )
    );

    return Subscribable.make({
      get: SynchronizedRef.get(stateRef),
      changes: Stream.changes(SynchronizedRef.changes(stateRef))
    });
  });
```

### Reconnection with Backoff

```typescript
const reconnectPolicy = Schedule.exponential("1 second", 2).pipe(
  Schedule.union(Schedule.spaced("30 seconds")),
  Schedule.whileInput((error) => isRetryableError(error))
);

const makeReconnectingClient = (options) =>
  Effect.retry(makeRoomClient(options), reconnectPolicy);
```

---

## Event Types (Extended)

```typescript
const RoomEvent = Schema.Union(
  // Existing
  TurnAccepted,
  ScoreUpdated,
  NpcPromptUpdated,
  RoomError,

  // New for multiplayer
  PlayerJoined,
  PlayerDisconnected,
  PlayerReconnected,
  NpcTurnGenerated,
  TurnAdvanced,
  ScenarioComplete
);
```

---

## File Structure

```
apps/api/src/
├── domain/
│   ├── MultiplayerState.ts      # State types, ParticipantType
│   ├── RoomRequests.ts          # TaggedRequest definitions
│   └── RoomProtocol.ts          # Extended event types
├── machines/
│   └── RoomMachine.ts           # ProcedureList state machine
├── durable-objects/
│   ├── RoomDurableObject.ts     # Machine.Actor integration
│   └── db/schema.ts             # player_sessions table
└── services/
    └── NpcGenerator.ts          # LLM dialogue generation

apps/web/
├── multiplayer/
│   ├── RoomClient.ts            # Event replay client
│   ├── RoomClientAtoms.ts       # React atoms
│   ├── RoomActions.ts           # Send commands
│   └── reconnect.ts             # Backoff logic
└── components/
    ├── MultiplayerRoom.tsx
    ├── TurnCard.tsx
    ├── PlayerList.tsx
    └── TurnInput.tsx
```

---

## Decoupled Scoring Architecture

### Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Decoupled** | ScoringPipeline has no knowledge of state machine |
| **Context-aware** | Full conversation history via ScoringContextBuilder |
| **Progressive** | Events emitted as each scoring stage completes |
| **Extensible** | New scoring dimensions = new event types |
| **Fault tolerant** | Scoring errors don't block state transitions |

### Scoring Context (Built from Event History)

```typescript
const ScoringContext = Schema.Struct({
  // Scenario setup
  scenario: Schema.Struct({
    topic: Schema.String,
    level: Schema.String,
    setting: Schema.String,
    objectives: Schema.Array(Schema.String),
    targetVocab: Schema.Array(Schema.String),
    targetGrammar: Schema.Array(Schema.String)
  }),

  // Current turn info
  currentTurn: Schema.Struct({
    stepIndex: Schema.Number,
    expectedAction: Schema.optional(Schema.String),
    promptGiven: Schema.optional(Schema.String)
  }),

  // Conversation history (reduced from events)
  history: Schema.Array(Schema.Struct({
    participant: ParticipantType,
    content: Schema.String,
    turnId: Schema.String,
    timestamp: Schema.Number,
    scores: Schema.optional(Schema.Struct({
      overall: Schema.Number,
      fluency: Schema.Number,
      vocab: Schema.Number
    }))
  })),

  // Player progression stats
  playerStats: Schema.Struct({
    playerId: Schema.String,
    turnsCompleted: Schema.Number,
    averageScore: Schema.Number,
    commonErrors: Schema.Array(Schema.String),
    vocabMastered: Schema.Array(Schema.String),
    vocabStruggling: Schema.Array(Schema.String)
  })
});
```

### Context Builder Service

```typescript
interface ScoringContextBuilder {
  buildContext: (options: {
    roomId: string;
    turnId: string;
    playerId: string;
  }) => Effect.Effect<ScoringContext, ContextBuildError, ContextDeps>;
}

// Reduces event history to conversation context
const reduceToConversationHistory = (events: RoomEvent[]): ConversationTurn[] => {
  // TurnAccepted → player turns
  // NpcTurnGenerated → NPC turns
  // ScoreFinalized → attach scores to turns
};
```

### Scoring Event Types (Extensible)

```typescript
// Emitted progressively as each stage completes
class ScoreFluency extends Schema.Class<ScoreFluency>("ScoreFluency")({
  type: Schema.Literal("ScoreFluency"),
  turnId: Schema.String,
  playerId: Schema.String,
  score: Schema.Number,
  metrics: Schema.Struct({ wordsPerMinute: Schema.Number, pauseCount: Schema.Number })
}) {}

class ScoreVocab extends Schema.Class<ScoreVocab>("ScoreVocab")({ /* ... */ }) {}
class ScoreGrammar extends Schema.Class<ScoreGrammar>("ScoreGrammar")({ /* ... */ }) {}
class ScoreRelevance extends Schema.Class<ScoreRelevance>("ScoreRelevance")({ /* ... */ }) {}
class ScoreLlmReview extends Schema.Class<ScoreLlmReview>("ScoreLlmReview")({ /* ... */ }) {}

// Final aggregation
class ScoreFinalized extends Schema.Class<ScoreFinalized>("ScoreFinalized")({
  type: Schema.Literal("ScoreFinalized"),
  turnId: Schema.String,
  overall: Schema.Number,
  breakdown: Schema.Struct({ fluency, vocab, grammar, relevance, naturalness }),
  weights: Schema.Struct({ /* configurable weights */ }),
  isFinal: Schema.Boolean
}) {}
```

### Scoring Pipeline (Uses Context, Emits Events)

```typescript
const ScoringPipelineLive = Layer.effect(
  ScoringPipeline,
  Effect.gen(function* () {
    const eventEmitter = yield* RoomEventEmitter;
    const contextBuilder = yield* ScoringContextBuilder;
    const config = yield* ScoringConfig;

    return {
      scoreTurn: (input) =>
        Effect.gen(function* () {
          // Build context from event history
          const context = yield* contextBuilder.buildContext(input);

          // Stage 1: Fluency (local, fast)
          const fluency = yield* computeFluency(input.transcript, input.audioFeatures);
          yield* eventEmitter.emit(new ScoreFluency({ ...fluency }));

          // Stage 2: Vocab (uses scenario.targetVocab)
          const vocab = yield* computeVocab(input.transcript, context.scenario.targetVocab);
          yield* eventEmitter.emit(new ScoreVocab({ ...vocab }));

          // Stage 3: Grammar (uses playerStats.commonErrors)
          const grammar = yield* computeGrammar(input.transcript, context.playerStats.commonErrors);
          yield* eventEmitter.emit(new ScoreGrammar({ ...grammar }));

          // Stage 4: Relevance (uses full history + current prompt)
          const relevance = yield* computeRelevance(input.transcript, context.history, context.currentTurn);
          yield* eventEmitter.emit(new ScoreRelevance({ ...relevance }));

          // Stage 5: LLM review (full context)
          const llmReview = yield* languageReview.review(input.transcript, context);
          yield* eventEmitter.emit(new ScoreLlmReview({ ...llmReview }));

          // Final aggregation
          const overall = aggregateScores(config.weights, { fluency, vocab, grammar, relevance, llmReview });
          yield* eventEmitter.emit(new ScoreFinalized({ overall, breakdown: {...}, isFinal: true }));

          // Update player stats
          yield* updatePlayerStats(input.playerId, { newErrors: grammar.errorTypes, vocabUsed: vocab.targetVocabUsed });
        })
    };
  })
);
```

### State Machine Integration (Fire-and-Forget)

```typescript
// In SubmitTurn handler - scoring runs independently
ProcedureList.add<SubmitTurn>()("SubmitTurn", (ctx) =>
  Effect.gen(function* () {
    const turnId = yield* generateTurnId;
    const scoringPipeline = yield* ScoringPipeline;

    // Fork scoring - does NOT block state machine
    yield* ctx.fork(
      scoringPipeline.scoreTurn({ turnId, playerId, transcript, audioFeatures, roomId })
        .pipe(Effect.catchAll((e) => emitEvent(new ScoringError({ turnId, error: String(e) }))))
    );

    // State advances immediately
    yield* ctx.send(new AdvanceStep({ completedStepIndex: ctx.state.stepIndex }));
    return [{ turnId }, processingState];
  })
)
```

### Scoring Dependency Graph

```
State Machine ──(fire-and-forget)──► ScoringPipeline
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
          ScoringContextBuilder     ScoringConfig         LanguageReview
                    │                 (weights)             (optional)
      ┌─────────────┼─────────────┐
      │             │             │
      ▼             ▼             ▼
  EventLog     ScenarioStore  PlayerStatsStore
  (history)      (setup)       (progression)

Output: ScoreFluency → ScoreVocab → ScoreGrammar → ScoreRelevance → ScoreLlmReview → ScoreFinalized
```

---

## Implementation Phases

1. **Phase 1: Domain & Requests** - Schema definitions
2. **Phase 2: Room Machine** - ProcedureList handlers + tests
3. **Phase 3: DO Integration** - Actor in Durable Object
4. **Phase 4: Client Architecture** - Replay + reconnection
5. **Phase 5: NPC Generation** - LLM integration
6. **Phase 6: Scoring Pipeline** - Context builder + progressive scoring

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Turn order | Dynamic via TurnPlan | Supports A-NPC-B-NPC patterns |
| Event handling | Machine + ProcedureList | Type-safe, composable handlers |
| NPC timing | DO alarms | Survives hibernation |
| Reconnection | Full replay | User sees complete history |
| State broadcast | Subscribable.changes | Reactive, automatic |
| Scoring coupling | Fire-and-forget from state machine | Scoring doesn't block turn flow |
| Scoring context | ScoringContextBuilder reduces events | Full history without state machine access |
| Scoring events | Progressive (per-stage) | UI shows scores as they compute |
| Player progression | PlayerStatsStore | Personalized feedback, track errors |

---

## Validated Architecture Issues

> Review conducted: 2026-01-16 | Tracked in beads: ensayo_quest-9oz, ensayo_quest-jq9, ensayo_quest-aw9, ensayo_quest-8lv, ensayo_quest-4mv

### Issue 1: Source of Truth Ambiguity (CRITICAL)

**Problem**: Events and state persist separately without atomicity. Design references undefined functions: `emitEvent()`, `persistRoomState()`, `getEventHistory()`, `broadcastStateUpdate()`.

**Effect Pattern Citation**:
- `@effect/experimental/src/EventJournal.ts` lines 31-36: `journal.write({ event, primaryKey, payload, effect })` - the `effect` callback runs atomically with the write
- `@effect/experimental/src/EventLog.ts` lines 640-672: `writeHandler` chains handler execution AFTER journal write

**Remediation**:
```typescript
// WRONG (design doc): separate persist + emit
yield* emitEvent({ type: "TurnAccepted", ... });
yield* persistRoomState(roomId, newState);

// CORRECT: Use EventLog.write with handler side effect
const eventLog = yield* EventLog;
yield* eventLog.write({
  schema: RoomEventSchema,
  event: "TurnAccepted",
  payload: { roomId, turnId, playerId, timestamp: Date.now() }
});
// Handler (registered via EventLog.group) persists state atomically
```

**Required Changes**:
1. Create `RoomEventHandlers.ts` using `EventLog.group()` pattern
2. Replace all `emitEvent()` calls with `EventLog.write()`
3. Implement `getEventHistory()` using `EventLog.entries`
4. Remove separate `persistRoomState()` calls (handled by event handlers)

---

### Issue 2: Turn Progression Conflict (CRITICAL)

**Problem**: Design shows two conflicting patterns for turn advancement:
- **Pattern A** (lines 165-169): `ctx.fork(scoreTurn().pipe(flatMap(() => ctx.send(AdvanceStep))))`
- **Pattern B** (lines 557-559): Immediate `ctx.send(AdvanceStep)` after fork

**Effect Pattern Citation**:
- `@effect/experimental/src/Machine.ts` lines 606-607: `fork` uses `Effect.asVoid(FiberSet.run(...))` - **non-blocking**
- `@effect/experimental/src/Machine.ts` lines 554-572, 673-675: `ctx.send = sendIgnore` (fire-and-forget, queues but doesn't wait)

**Correct Semantic**: Pattern A is correct. State becomes "Processing" immediately, AdvanceStep queued AFTER scoring completes.

**Remediation**:
```typescript
// CORRECT: Pattern A - scoring blocks advancement via fiber chaining
ProcedureList.add<SubmitTurn>()("SubmitTurn", (ctx) =>
  Effect.gen(function* () {
    const turnId = yield* generateTurnId;

    // Fork chains scoring → advancement
    yield* ctx.fork(
      ScoringService.evaluate({ turnId, ... }).pipe(
        Effect.flatMap(() => ctx.send(new AdvanceStep({ completedStepIndex: ctx.state.stepIndex }))),
        Effect.catchAll((e) => emitEvent(new ScoringError({ turnId, error: String(e) })))
      )
    );

    // Handler returns immediately with Processing state
    return [{ turnId }, { _tag: "Processing", turnId }];
  })
)
```

**Required Changes**:
1. Remove Pattern B from design (lines 545-561 are INVALID)
2. Add idempotency guard to AdvanceStep handler (prevent double-advance on retry)

---

### Issue 3: Command Idempotency Undefined (HIGH)

**Problem**: No request IDs for SubmitTurn/GenerateNpcTurn. DO alarms fire up to 7 times (at-least-once semantics).

**Cloudflare Citation**: DO alarms guarantee "at-least-once execution" with exponential backoff retries.

**Existing Pattern Citation**: `/apps/api/src/index.ts` lines 216-222 shows working idempotency:
```typescript
const alreadyProcessed = yield* db.isMessageProcessed(message.id);
if (alreadyProcessed) { message.ack(); return; }
yield* consumer.handle(message.body);
yield* db.markMessageProcessed(message.id);
```

**Remediation**:

```typescript
// SubmitTurn with requestId
class SubmitTurn extends Schema.TaggedRequest<SubmitTurn>()(
  "SubmitTurn",
  { failure: Schema.String, success: Schema.Struct({ turnId: Schema.String }) },
  {
    playerId: Schema.String,
    transcript: Schema.String,
    audioFeatures: AudioFeatures,
    requestId: Schema.String,  // NEW: UUID from client
    clientTimestamp: Schema.Number
  }
) {}

// Handler with idempotency check
ProcedureList.add<SubmitTurn>()("SubmitTurn", (ctx) =>
  Effect.gen(function* () {
    const alreadyProcessed = yield* db.checkTurnRequest(ctx.request.requestId);
    if (alreadyProcessed) {
      const cached = yield* db.getCachedTurnResult(ctx.request.requestId);
      return [{ turnId: cached.turnId }, ctx.state]; // Idempotent return
    }
    // ... normal processing
  })
)

// Alarm handler with guard
async alarm(alarmInfo?: { isRetry?: boolean; retryCount?: number }) {
  const pending = await this.runtime.runPromise(loadPendingNpc());
  if (!pending) return;

  const alreadySent = await this.runtime.runPromise(
    db.checkAlarmFired(pending.npcId, pending.stepIndex, pending.scheduledAt)
  );
  if (alreadySent) return; // Idempotent skip

  await this.runtime.runPromise(db.markAlarmFired({ ... }));
  await this.runtime.runPromise(this.actor!.send(new GenerateNpcTurn({ ... })));
}
```

**Required Changes**:
1. Add `requestId` to SubmitTurn, GenerateNpcTurn schemas
2. Create `turn_requests` and `alarm_processing` idempotency tables
3. Add idempotency checks in all command handlers
4. Add alarm guards before sending GenerateNpcTurn

---

### Issue 4: Participant Membership/Auth Not Modeled (HIGH)

**Problem**: MultiplayerRoomState has no participant list. webSocketOpen not implemented. No authentication layer.

**Security Gaps**:
- Any user can claim to be any playerId
- No max player limit
- No session management
- No rejoin validation

**Remediation - New Schemas**:

```typescript
// Participant status tracking
class ParticipantStatus extends Schema.Class<ParticipantStatus>("ParticipantStatus")({
  participant: ParticipantType,
  connectedAt: Schema.optional(Schema.Number),
  lastHeartbeat: Schema.optional(Schema.Number),
  sessionId: Schema.optional(Schema.String),
  isConnected: Schema.Boolean,
  rejoinAttempts: Schema.Number
}) {}

// Room participants registry
class RoomParticipants extends Schema.Class<RoomParticipants>("RoomParticipants")({
  roomId: Schema.String,
  expectedParticipants: Schema.Array(ParticipantType),  // from TurnPlan
  activeParticipants: Schema.Record(Schema.String, ParticipantStatus),
  maxPlayers: Schema.Number
}) {}

// Enhanced state with participants
const EnhancedMultiplayerRoomState = Schema.Union(
  Schema.Struct({
    _tag: Schema.Literal("AwaitingTurn"),
    participant: ParticipantType,
    stepIndex: Schema.Number,
    participants: RoomParticipants  // NEW
  }),
  // ... other states
);
```

**Remediation - WebSocket Handlers**:

```typescript
// In RoomDurableObject
async webSocketOpen(ws: WebSocket) {
  const playerId = this.extractPlayerId(ws);
  const sessionId = generateSessionId();

  // Validate expected
  const expected = await this.loadExpectedParticipants();
  if (!expected.find(p => p.playerId === playerId)) {
    ws.close(403, "not_invited");
    return;
  }

  // Validate not already connected
  const active = await this.loadActiveSessions();
  if (active.some(s => s.playerId === playerId && s.isConnected)) {
    ws.close(409, "already_connected");
    return;
  }

  ws.serializeAttachment({ playerId, sessionId, connectedAt: Date.now() });
  await this.actor!.send(new PlayerJoin({ playerId, sessionId }));

  const events = await this.getEventHistory();
  ws.send(JSON.stringify({ type: "replay", events }));
}

async webSocketClose(ws: WebSocket, code: number, reason: string) {
  const { playerId, sessionId } = ws.deserializeAttachment();
  await this.actor!.send(new PlayerDisconnected({ playerId, sessionId }));
  this.scheduleRejoinTimeout(playerId, 30_000);
}
```

**Required Changes**:
1. Define ParticipantStatus, RoomParticipants schemas
2. Add participants field to MultiplayerRoomState
3. Implement webSocketOpen, webSocketClose, webSocketMessage handlers
4. Add participant_sessions table
5. Add authentication layer (JWT or Cloudflare Access)

---

### Issue 5: Replay/Scoring Scalability (MEDIUM - DEFERRED)

**Problem**: Full event replay and full history in ScoringContext. No snapshots, no event versioning.

**MVP Assessment**: Event volumes negligible (40-120 events/session = ~15 KB). Not urgent for MVP.

**Effect Pattern Citation**: `@effect/experimental/src/EventLog.ts` lines 265-275 provides `groupCompaction` API for snapshot/compaction.

**Deferred Remediation (Week 2-3)**:
1. Add RoomSnapshot event type
2. Implement compaction trigger (emit snapshot every N turns)
3. Implement compaction handler (delete old events)
4. Add event versioning via Schema transformations

**MVP Safeguard**:
```typescript
// Limit ScoringContext history to last 15 turns
const reduceToConversationHistory = (events: RoomEvent[], limit = 15) => {
  const turnEvents = events.filter(e =>
    e._tag === "TurnAccepted" || e._tag === "NpcTurnGenerated"
  );
  return turnEvents.slice(-limit).map(toHistoryEntry);
};
```

---

## Final Architecture Diagram (Post-Review)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MULTIPLAYER ROOM ARCHITECTURE                           │
│                        (with validated remediations)                         │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────────┐
                              │   Web Client     │
                              │  (React + Atoms) │
                              └────────┬─────────┘
                                       │ WebSocket + requestId
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        RoomDurableObject (Cloudflare)                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │ webSocketOpen() ──► Validate participant ──► Create session ──► Join  │   │
│  │ webSocketClose() ──► Mark disconnected ──► Schedule rejoin timeout    │   │
│  │ webSocketMessage() ──► Validate session ──► Route to Machine          │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│                                     ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    RoomMachine (Effect ProcedureList)                  │   │
│  │                                                                        │   │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │   │ PlayerJoin  │  │ SubmitTurn  │  │ GenerateNpc │  │ AdvanceStep │  │   │
│  │   │             │  │ +requestId  │  │ +requestId  │  │ +idempotency│  │   │
│  │   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │   │
│  │          │                │                │                │         │   │
│  │          ▼                ▼                ▼                ▼         │   │
│  │   ┌──────────────────────────────────────────────────────────────┐   │   │
│  │   │              Idempotency Layer (SQLite)                      │   │   │
│  │   │  turn_requests | npc_turns_generated | alarm_processing      │   │   │
│  │   └──────────────────────────────────────────────────────────────┘   │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │   ┌──────────────────────────────────────────────────────────────┐   │   │
│  │   │                   State Transitions                           │   │   │
│  │   │                                                               │   │   │
│  │   │   AwaitingTurn ──► Processing ──► NpcPending ──► AwaitingTurn │   │   │
│  │   │        │                │                │              │      │   │   │
│  │   │        └────────────────┴────────────────┴──────► Complete     │   │   │
│  │   │                                                               │   │   │
│  │   │   + participants: RoomParticipants (validated membership)     │   │   │
│  │   └──────────────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│                                     ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    EventLog (Source of Truth)                         │   │
│  │                                                                        │   │
│  │   EventLog.write({ event, payload })                                  │   │
│  │         │                                                              │   │
│  │         ├──► EventJournal.write() ──► ATOMIC PERSIST                  │   │
│  │         │         │                                                    │   │
│  │         │         └──► effect: handler runs AFTER journal write       │   │
│  │         │                    │                                         │   │
│  │         │                    ├──► Persist room_state                   │   │
│  │         │                    └──► Broadcast to clients                 │   │
│  │         │                                                              │   │
│  │         └──► EventLog.entries ──► getEventHistory() for replay        │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                     │                                        │
│                                     │ DO Alarm (at-least-once)               │
│                                     ▼                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │                    alarm() Handler (with guard)                       │   │
│  │                                                                        │   │
│  │   if (alreadyFired(npcId, stepIndex, scheduledAt)) return;            │   │
│  │   markAlarmFired({ ... });                                            │   │
│  │   actor.send(new GenerateNpcTurn({ requestId, ... }));                │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ Queue (fire-and-forget)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ScoringPipeline (Decoupled)                         │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐    │
│   │                     ScoringContextBuilder                           │    │
│   │                                                                      │    │
│   │   EventLog.entries ──► reduceToConversationHistory(limit=15)        │    │
│   │                    ──► scenario + currentTurn + playerStats         │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│                                     │                                        │
│                                     ▼                                        │
│   ┌─────────────────────────────────────────────────────────────────────┐    │
│   │                     Progressive Scoring                             │    │
│   │                                                                      │    │
│   │   computeFluency ──► ScoreFluency event                             │    │
│   │   computeVocab   ──► ScoreVocab event                               │    │
│   │   computeGrammar ──► ScoreGrammar event                             │    │
│   │   LLM review     ──► ScoreLlmReview event                           │    │
│   │   aggregate      ──► ScoreFinalized event                           │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           KEY INVARIANTS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. EventLog is single source of truth (events → state derivation)           │
│ 2. All commands have requestId for idempotency                              │
│ 3. State persisted atomically with events via journal.write().effect()      │
│ 4. Scoring is fire-and-forget via ctx.fork() (Pattern A)                    │
│ 5. AdvanceStep queued AFTER scoring completes (not immediately)             │
│ 6. DO alarms guarded by alarm_processing table                              │
│ 7. WebSocket handlers validate session before processing                    │
│ 8. Participant membership tracked in RoomParticipants                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Priority

| Priority | Issue | Effort | Dependencies |
|----------|-------|--------|--------------|
| **P0** | Event-State Source of Truth | 8h | None |
| **P0** | Turn Progression (Pattern A + idempotency) | 4h | P0.1 |
| **P1** | Command Idempotency | 6h | P0.1, P0.2 |
| **P1** | Participant Membership/Auth | 8h | P0.1 |
| **P2** | Scalability (compaction, versioning) | 6h | Post-MVP |

**Total estimated effort**: ~26h for P0+P1 (pre-implementation foundation)
