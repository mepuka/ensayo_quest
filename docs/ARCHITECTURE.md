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

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      MULTIPLAYER ROOM ARCHITECTURE                           │
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
```

---

## Key Invariants

These are **non-negotiable** architectural rules. Any code change that violates these must be flagged.

| # | Invariant | Rationale |
|---|-----------|-----------|
| 1 | **EventLog is the single source of truth** | Events derive state; state is never persisted independently |
| 2 | **All commands have requestId for idempotency** | Network retries, DO alarm re-fires (up to 7x) must be safe |
| 3 | **State persisted atomically with events** | Use `journal.write().effect()` - never separate persist calls |
| 4 | **Scoring is fire-and-forget via ctx.fork()** | Scoring does NOT block turn flow |
| 5 | **AdvanceStep queued AFTER scoring completes** | Pattern A: `ctx.fork(scoring → ctx.send(AdvanceStep))` |
| 6 | **DO alarms guarded by idempotency table** | Check `alarm_processing` before sending GenerateNpcTurn |
| 7 | **WebSocket handlers validate session** | Every message must have valid sessionId |
| 8 | **Participant membership tracked in state** | RoomParticipants with expected + active participants |

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

// CORRECT: Chain scoring → advancement inside fork
yield* ctx.fork(
  scoreTurn(...).pipe(
    Effect.flatMap(() => ctx.send(new AdvanceStep({ ... })))
  )
);
return [{ turnId }, { _tag: "Processing" }];

// WRONG: Immediate advancement after fork
yield* ctx.fork(scoreTurn(...));
yield* ctx.send(new AdvanceStep({ ... }));  // RACE CONDITION
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

```
                    ┌─────────────────┐
                    │   AwaitingTurn  │◄──────────────────────────┐
                    │   (participant) │                           │
                    └────────┬────────┘                           │
                             │ SubmitTurn (player)                │
                             │ or GenerateNpcTurn (npc)           │
                             ▼                                    │
                    ┌─────────────────┐                           │
                    │   Processing    │                           │
                    │   (turnId)      │                           │
                    └────────┬────────┘                           │
                             │ AdvanceStep                        │
                             │ (after scoring for player,         │
                             │  immediately for NPC)              │
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

---

## Tracked Issues

These architectural issues have been identified and tracked:

| Bead | Severity | Issue | Status |
|------|----------|-------|--------|
| ensayo_quest-9oz | P0 | Event-State Source of Truth | Open |
| ensayo_quest-jq9 | P0 | Turn Progression Double-Advance | Open |
| ensayo_quest-aw9 | P1 | Command Idempotency | Open |
| ensayo_quest-8lv | P1 | Participant Membership/Auth | Open |
| ensayo_quest-4mv | P2 | Scalability (deferred) | Open |

See `docs/plans/2026-01-16-multiplayer-architecture-design.md` for full remediation details.

---

## Changelog

| Date | Change | Reason |
|------|--------|--------|
| 2026-01-16 | Initial architecture | Multiplayer design review |
| 2026-01-16 | Added validated issues | Deep dive investigation |
