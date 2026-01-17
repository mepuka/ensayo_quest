# Ensayo Quest Architecture Reference

> **CANONICAL SOURCE OF TRUTH** for system architecture.
> Last reviewed: 2026-01-16 | Related: `docs/plans/2026-01-16-multiplayer-architecture-design.md`

## Usage

**Before implementing ANY code changes:**

1. Read this document to understand the architectural invariants
2. If your implementation would conflict with this architecture, STOP and surface the conflict
3. If the architecture needs to change, update this document FIRST, then implement

**If you find conflicts or ambiguities:**

- Do NOT proceed with code changes
- Surface the conflict explicitly to the user
- Propose architectural changes if needed
- Wait for approval before implementation

---

## System Diagram

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MULTIPLAYER ROOM (CORE FLOW)                        │
└─────────────────────────────────────────────────────────────────────────────┘

Web Client (Browser)
  │ WebSocket {sessionId, requestId}
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ RoomDurableObject (Cloudflare DO - per-room singleton)                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Session/Auth + participant validation                                 │  │
│  │ Command Router → IdempotencyStore (requestId → prior result)          │  │
│  │ RoomMachine (commands → events via ProcedureList)                     │  │
│  │ EventLog (append-only, source of truth)                               │  │
│  │ Projections: RoomState snapshot + WebSocket broadcast                 │  │
│  │ alarm() handler (at-least-once) → GenerateNpcTurn(requestId)          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ON TurnAccepted EVENT:                                                     │
│    1. Persist event to EventLog (atomic)                                    │
│    2. Emit AdvanceStep immediately (does NOT wait for audio or scoring)     │
│    3. Broadcast state update to clients                                     │
│    NOTE: Queue enqueue moved to AudioUploaded (see below)                   │
│                                                                             │
│  ON AudioUploaded EVENT:                                                    │
│    1. Persist event to EventLog (atomic)                                    │
│    2. Enqueue to TURN_QUEUE (fire-and-forget, gates scoring on audio)       │
│    3. Broadcast state update to clients                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               │ Cloudflare Queue (async, decoupled)
                               │ Triggered by AudioUploaded, NOT TurnAccepted
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Queue Consumer (Cloudflare Worker - separate from DO)                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ TurnScoringConsumer                                                   │  │
│  │   - Receives {roomId, turnId} from TURN_QUEUE                         │  │
│  │   - Verifies AudioUploaded event exists (defense in depth)            │  │
│  │   - Fetches audio from R2 (guaranteed to exist after AudioUploaded)   │  │
│  │   - Builds ScoringContext from EventLog (last 15 turns)               │  │
│  │   - Runs scoring pipeline (fluency, vocab, grammar, LLM review)       │  │
│  │   - Runs Gemini audio analysis (pronunciation, fluency assessment)    │  │
│  │   - Emits Score* events back to EventLog via DO POST                  │  │
│  │   - Idempotent via processed_queue_messages table                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  SCORING DOES NOT BLOCK TURN FLOW - it runs asynchronously after audio     │
│  State advances immediately; scores appear later via event stream          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Runtime Boundaries

| Component | Runtime | Isolation | Purpose |
| --------- | ------- | --------- | ------- |
| **Web Client** | Browser | Per-user | UI, WebSocket connection, local state |
| **RoomDurableObject** | Cloudflare DO | Per-room singleton | State machine, EventLog, WebSocket hub |
| **Queue Consumer** | Cloudflare Worker | Shared pool | Async scoring, does NOT live in DO |
| **D1 Database** | Cloudflare D1 | Shared | Turn records, idempotency tables |
| **R2 Bucket** | Cloudflare R2 | Shared | Audio file storage |

**Critical boundary**: Scoring runs in **Queue Consumer (Worker)**, NOT inside the Durable Object. This prevents scoring latency from blocking turn progression and keeps DO load minimal.

---

## Events

Room state is derived from these events via the EventLog:

| Event | Purpose | Payload |
| ----- | ------- | ------- |
| **RoomInitialized** | Room creation with seed data | roomId, scenarioId, seedPrompt, topic, level, timestamp |
| **TurnAccepted** | Player turn recorded | roomId, turnId, playerId, transcript, timestamp |
| **ScoreUpdated** | Turn scoring completed | roomId, turnId, scores, feedback, nextPrompt |
| **NpcTurnGenerated** | NPC response created | roomId, turnId, npcId, content, stepIndex, timestamp |
| **TurnAdvanced** | Turn progression | roomId, fromStepIndex, toStepIndex, nextParticipantType/Id |
| **PlayerJoined** | Player connected | roomId, playerId, sessionId, timestamp |
| **PlayerDisconnected** | Player disconnected | roomId, playerId, sessionId, timestamp |
| **RoomCompleted** | Session finished | roomId, summary, timestamp |
| **RoomError** | Error occurred | roomId, code, message, retryable, timestamp |
| **AudioUploaded** | Audio uploaded to R2 | roomId, turnId, audioKey, requestId, fileSizeBytes, timestamp |

**Note:** `RoomInitialized` persists room metadata (seedPrompt, topic, level) to EventLog. This data survives page refresh and is the source of truth for room configuration. `RoomProjection` contains only game state (whose turn, step index), not room metadata.

---

## Key Invariants

These are **non-negotiable** architectural rules. Any code change that violates these must be flagged.

| #   | Invariant                                   | Rationale                                                    |
| --- | ------------------------------------------- | ------------------------------------------------------------ |
| 1   | **EventLog is the single source of truth**  | Events derive state; state is never persisted independently  |
| 2   | **All commands are idempotent via requestId** | Network retries and DO alarm re-fires must be safe          |
| 3   | **Event append + projections are atomic**   | Use `journal.write().effect()` - no separate persist calls   |
| 4   | **Scoring runs in Queue Consumer, not DO**  | Decoupled via Cloudflare Queue; never blocks turn flow       |
| 5   | **AdvanceStep is emitted once per turn**    | Single advancement path; avoid double-advance races          |
| 6   | **DO alarms are guarded by idempotency**    | Check guard store before GenerateNpcTurn                     |
| 7   | **WebSocket handlers validate session**     | Every message must have valid sessionId                      |
| 8   | **Participant membership tracked in state** | RoomParticipants with expected + active participants         |
| 9   | **Scoring enqueue gated on AudioUploaded**  | Queue consumer needs audio from R2; prevents race condition  |
| 10  | **Room creation idempotent via requestId**  | D1 table + re-emit pattern for atomicity gap recovery        |

---

## Effect Patterns (Required)

These Effect APIs must be used correctly per the design:

### Machine + ProcedureList

```typescript
// CORRECT: Type-safe state machine with handlers
const RoomMachine = Machine.make((input) =>
  ProcedureList.make<State>(initialState, { identifier })
    .pipe(
      ProcedureList.add<Request>()("Tag", handler),
      ProcedureList.addPrivate<InternalRequest>()("InternalTag", handler)
    )
);
```

### ctx.fork() Semantics

```typescript
// ctx.fork() is NON-BLOCKING (Effect.asVoid(FiberSet.run(...)))
// Handler returns IMMEDIATELY after fork

// CORRECT: Fire-and-forget scoring; advancement is command-driven
yield* ctx.fork(
  scoreTurn(...)
);
return [{ turnId }, { _tag: "Processing" }];

// WRONG: Two advancement paths for the same turn
yield* ctx.fork(scoreTurn(...).pipe(
  Effect.flatMap(() => ctx.send(new AdvanceStep({ ... })))
));
yield* ctx.send(new AdvanceStep({ ... }));  // DOUBLE-ADVANCE
```

### ctx.send() Semantics

```typescript
// ctx.send = sendIgnore (fire-and-forget, queues but doesn't wait)
// ctx.sendAwait = send (blocks for response)

// Use ctx.send() for internal dispatch (most cases)
// Use ctx.sendAwait() only when you need the response
```

### EventLog Write Pattern

```typescript
// CORRECT: Atomic event + side effect
yield* eventLog.write({
  schema: RoomEventSchema,
  event: "TurnAccepted",
  payload: { roomId, turnId, playerId }
});
// Handler registered via EventLog.group() persists state

// WRONG: Separate event and state persistence
yield* emitEvent({ ... });       // NOT ATOMIC
yield* persistRoomState({ ... }); // RACE CONDITION
```

---

## State Machine Transitions

```text
                    ┌─────────────────┐
                    │   AwaitingTurn  │◄──────────────────────────┐
                    │   (participant) │                           │
                    └────────┬────────┘                           │
                             │ SubmitTurn (player)                │
                             │ or GenerateNpcTurn (npc)           │
                             ▼                                    │
                    ┌─────────────────┐                           │
                    │   Processing    │ ← TRANSIENT STATE         │
                    │   (turnId)      │   (milliseconds only)     │
                    └────────┬────────┘                           │
                             │ AdvanceStep (IMMEDIATE)            │
                             │                                    │
                             │ NOTE: AdvanceStep fires right      │
                             │ after TurnAccepted. Processing     │
                             │ does NOT wait for scoring.         │
                             │ Scoring runs async in Queue.       │
                             ▼                                    │
              ┌──────────────┴──────────────┐                     │
              │                             │                     │
              ▼                             ▼                     │
     ┌─────────────────┐          ┌─────────────────┐             │
     │   NpcPending    │          │    Complete     │             │
     │   (npcId)       │          │                 │             │
     └────────┬────────┘          └─────────────────┘             │
              │ alarm() → GenerateNpcTurn                         │
              └───────────────────────────────────────────────────┘
```

**Processing State Semantics:**

- **Entry**: Turn accepted (TurnAccepted event emitted)
- **Duration**: Milliseconds (only as long as AdvanceStep takes to process)
- **Exit**: AdvanceStep fires immediately, NOT gated by audio upload or scoring
- **Audio Upload**: Client uploads audio separately; AudioUploaded event triggers scoring enqueue
- **Scoring**: Runs asynchronously in Queue Consumer after AudioUploaded; Score* events arrive later
- **Client UX**: Client sees turn accepted immediately; uploads audio; scores stream in progressively

**Audio Upload Flow** (runs parallel to turn progression):

```text
TurnAccepted → AdvanceStep → (room continues)
     │
     └─── Client uploads audio ─┬─► AudioUploaded event
                                └─► Enqueue to TURN_QUEUE
                                └─► TurnScoringConsumer processes
```

---

## Tracked Issues

These architectural issues have been identified and tracked:

| Bead             | Severity | Issue                          | Status   |
| ---------------- | -------- | ------------------------------ | -------- |
| ensayo_quest-9oz | P0       | Event-State Source of Truth    | ✅ Closed |
| ensayo_quest-jq9 | P0       | Turn Progression Double-Advance | ✅ Closed |
| ensayo_quest-aw9 | P1       | Command Idempotency            | ✅ Closed |
| ensayo_quest-8lv | P1       | Participant Membership/Auth    | ✅ Closed |
| ensayo_quest-4mv | P2       | Scalability (deferred)         | Open     |

See `docs/plans/2026-01-16-multiplayer-architecture-design.md` for full remediation details.

---

## Changelog

| Date       | Change                          | Reason                                     |
| ---------- | ------------------------------- | ------------------------------------------ |
| 2026-01-16 | Initial architecture            | Multiplayer design review                  |
| 2026-01-16 | Added validated issues          | Deep dive investigation                    |
| 2026-01-16 | Clarified scoring runtime       | Scoring in Queue Consumer, not DO          |
| 2026-01-16 | Clarified Processing state      | Transient state, does not wait for scoring |
| 2026-01-16 | Moved scoring enqueue to AudioUploaded      | Fixes race condition; audio must exist before scoring |
| 2026-01-16 | Added Events section + RoomInitialized      | Frontend state consolidation - persist room metadata  |
| 2026-01-16 | Added Invariant #10 (room creation idempotency) | createRoom now requires requestId for retry safety |
