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
│    2. Enqueue to TURN_QUEUE (fire-and-forget)                               │
│    3. Emit AdvanceStep immediately (does NOT wait for scoring)              │
│    4. Broadcast state update to clients                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                               │
                               │ Cloudflare Queue (async, decoupled)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Queue Consumer (Cloudflare Worker - separate from DO)                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ TurnScoringConsumer                                                   │  │
│  │   - Receives {roomId, turnId} from TURN_QUEUE                         │  │
│  │   - Builds ScoringContext from EventLog (last 15 turns)               │  │
│  │   - Runs scoring pipeline (fluency, vocab, grammar, LLM review)       │  │
│  │   - Emits Score* events back to EventLog via DO POST                  │  │
│  │   - Idempotent via processed_queue_messages table                     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  SCORING DOES NOT BLOCK TURN FLOW - it runs asynchronously after turn      │
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
- **Exit**: AdvanceStep fires immediately, NOT gated by scoring
- **Scoring**: Runs asynchronously in Queue Consumer; Score* events arrive later
- **Client UX**: Client sees turn accepted immediately; scores stream in progressively

---

## Tracked Issues

These architectural issues have been identified and tracked:

| Bead             | Severity | Issue                          | Status |
| ---------------- | -------- | ------------------------------ | ------ |
| ensayo_quest-9oz | P0       | Event-State Source of Truth    | Open   |
| ensayo_quest-jq9 | P0       | Turn Progression Double-Advance | Open   |
| ensayo_quest-aw9 | P1       | Command Idempotency            | Open   |
| ensayo_quest-8lv | P1       | Participant Membership/Auth    | Open   |
| ensayo_quest-4mv | P2       | Scalability (deferred)         | Open   |

See `docs/plans/2026-01-16-multiplayer-architecture-design.md` for full remediation details.

---

## Changelog

| Date       | Change                          | Reason                                     |
| ---------- | ------------------------------- | ------------------------------------------ |
| 2026-01-16 | Initial architecture            | Multiplayer design review                  |
| 2026-01-16 | Added validated issues          | Deep dive investigation                    |
| 2026-01-16 | Clarified scoring runtime       | Scoring in Queue Consumer, not DO          |
| 2026-01-16 | Clarified Processing state      | Transient state, does not wait for scoring |
