# Production Code Review Spec - Room EventLog Sync

Status: Draft (production review)
Date: 2026-01-17
Scope: commits af53c3b, e017364, d4ddc18, eef7ae5, 9aa5e98, 532d6ed

## Purpose
Persist the latest end-to-end review findings for Room EventLog sync and data flow.
This spec is intended to guide production fixes and align engineering work to
Effect's EventLog protocol requirements and the system architecture.

## References
- Architecture invariants: `docs/ARCHITECTURE.md`
- Room DO + WS flow: `apps/api/src/durable-objects/RoomDurableObject.ts:72`
- Room protocol (client events + payload schemas): `apps/shared/src/RoomProtocol.ts:33`
- Room DO stub creation: `apps/api/src/index.ts:136`
- EventLog client identity: `apps/web/eventlog/EventLogClient.ts:33`
- Effect EventLogRemote protocol: `effect/packages/experimental/src/EventLogRemote.ts:324`
- Effect EventLog server storage + changes: `effect/packages/experimental/src/EventLogServer.ts:97`
- Effect EventLog server DO adapter: `effect/packages/experimental/src/EventLogServer/Cloudflare.ts:106`
- Effect EventJournal remote sequence tracking: `effect/packages/experimental/src/EventJournal.ts:246`
- Effect EventLog remote wiring: `effect/packages/experimental/src/EventLog.ts:512`
- Effect EventLog identity + encryption: `effect/packages/experimental/src/EventLog.ts:408`, `effect/packages/experimental/src/EventLogEncryption.ts:65`

## End-to-End Data Flow (Expected)
1) Client derives room identity from roomId and opens WS to `/api/rooms/:roomId/stream`.
2) DO validates session, accepts WS, and serves EventLogRemote protocol.
3) EventLogRemote sends RequestChanges with `publicKey` (room identity) and `startSequence`.
4) DO returns persisted EventLog entries in Changes; client decrypts and replays.
5) HTTP events (TurnAccepted, ScoreUpdated, etc.) append to EventLog and are surfaced via WS.

Expected behavior is based on architecture invariants (`docs/ARCHITECTURE.md`) and
Effect's EventLogRemote protocol/sequence semantics
(`effect/packages/experimental/src/EventLogRemote.ts:324`,
`effect/packages/experimental/src/EventLog.ts:512`,
`effect/packages/experimental/src/EventJournal.ts:246`).

## Current Observed Data Flow (As Implemented)
1) DO uses `state.id.toString()` as `roomId` and publicKey for broadcast identity.
   `apps/api/src/durable-objects/RoomDurableObject.ts:292`
2) Client derives identity from route roomId.
   `apps/web/eventlog/EventLogClient.ts:33`
3) HTTP events are persisted via `EventLog.write()` but WS broadcast uses manual
   `EventLogRemote.Changes` constructed from the incoming event envelope.
   `apps/api/src/durable-objects/RoomDurableObject.ts:333`
4) Broadcast uses payload encoders keyed by `event.type` and assigns `sequence: index`
   without persisting to EventLogServer storage.
   `apps/api/src/durable-objects/RoomDurableObject.ts:349`

## Effect Protocol Requirements (Cited)
1) Remote sync is keyed by `publicKey` and identity; Changes are decrypted using the
   identity bound to that `publicKey`.
   `effect/packages/experimental/src/EventLogRemote.ts:349`,
   `effect/packages/experimental/src/EventLogRemote.ts:389`,
   `effect/packages/experimental/src/EventLog.ts:408`,
   `effect/packages/experimental/src/EventLogEncryption.ts:65`
2) Remote sync expects monotonic sequences with persistent storage backing.
   `startSequence` is derived from `EventJournal.nextRemoteSequence`.
   `effect/packages/experimental/src/EventLog.ts:512`,
   `effect/packages/experimental/src/EventJournal.ts:338`,
   `effect/packages/experimental/src/EventLogServer.ts:97`

## Findings (Ordered by Severity)

### P0-01: Room identity/publicKey mismatch breaks EventLogRemote sync
Evidence:
- DO identity uses `state.id.toString()` as roomId/publicKey.
  `apps/api/src/durable-objects/RoomDurableObject.ts:292`,
  `apps/api/src/durable-objects/RoomDurableObject.ts:77`
- Client identity uses route roomId (name-based), not DO id.
  `apps/web/eventlog/EventLogClient.ts:33`
- DO stub uses `idFromName(roomId)` so `state.id.toString()` is not the roomId name.
  `apps/api/src/index.ts:136`
- EventLogRemote routes Changes via `publicKey` + identity to decrypt entries.
  `effect/packages/experimental/src/EventLogRemote.ts:349`,
  `effect/packages/experimental/src/EventLogRemote.ts:389`

Impact:
- Clients subscribe with a different publicKey than the DO broadcasts or stores.
- Result: decryption failures, missing Changes, and event stream gaps on reconnect.

Proposed fix:
- Derive `roomId` from the request path or envelope and use it consistently for:
  - EventLog identity (`publicKey`)
  - Session validation (`participant_sessions.room_id`)
  - EventLog primaryKey and broadcast identity
- Pass roomId into `broadcastEventToClients` instead of using `this.roomId`.
- Remove reliance on `state.id.toString()` for identity or protocol semantics.

Verification:
- Add a WS integration test that asserts a client receives a `TurnAccepted` event
  after reconnect using the same roomId.

### P0-02: Broadcast payload encoding mismatches drop ScoreUpdated/RoomCompleted/RoomError
Evidence:
- Client event shapes differ from server payload schemas:
  - ScoreUpdated event uses `{ evaluation }` without roomId/timestamp.
    `apps/shared/src/RoomProtocol.ts:67`
  - RoomCompleted event uses `{ summary }` without roomId/timestamp.
    `apps/shared/src/RoomProtocol.ts:73`
  - RoomError event uses `type: "Error"` (not "RoomError") and omits roomId/timestamp.
    `apps/shared/src/RoomProtocol.ts:78`
- Broadcast uses `payloadEncoders[event.type]` on `payloadWithoutType`.
  `apps/api/src/durable-objects/RoomDurableObject.ts:349`,
  `apps/shared/src/RoomProtocol.ts:261`
- Payload schemas for encoding require roomId/timestamp and score fields.
  `apps/shared/src/RoomProtocol.ts:176`

Impact:
- Broadcast encoding fails or skips these events.
- Clients never receive ScoreUpdated / RoomCompleted / RoomError via WS.

Proposed fix:
- Convert inbound `RoomEvent` to the server payload schema before encoding:
  - ScoreUpdated: map `evaluation` to scores/feedback/nextPrompt + roomId.
  - RoomCompleted/RoomError: inject roomId + timestamp.
  - Normalize `RoomError` event type to "RoomError" for encoding.
- Alternative: broadcast from the actual EventLog entry payload instead of the
  inbound envelope, so the payload already matches the MsgPack schema.

Verification:
- WS test that sends a ScoreUpdated envelope and asserts the client reducer
  receives a ScoreUpdated event with populated evaluation.

### P1-01: WS replay and sequence semantics are broken by manual Changes
Evidence:
- Broadcast assigns `sequence: index` and does not persist to EventLogServer storage.
  `apps/api/src/durable-objects/RoomDurableObject.ts:370`
- EventLogRemote uses `startSequence` from `EventJournal.nextRemoteSequence` and
  expects persisted changes from storage on reconnect.
  `effect/packages/experimental/src/EventLog.ts:512`,
  `effect/packages/experimental/src/EventJournal.ts:338`
- EventLogServer serves Changes from `storage.entries/startSequence`.
  `effect/packages/experimental/src/EventLogServer/Cloudflare.ts:106`,
  `effect/packages/experimental/src/EventLogServer.ts:199`

Impact:
- Reconnects always request from sequence 0 but server has no entries.
- Clients lose history and cannot resync after disconnects.

Proposed fix:
- On broadcast, write entries through `EventLogServer.Storage.write` to get
  authoritative `EncryptedRemoteEntry.sequence` values, then send Changes using
  those returned entries.
- Ensure DO responds to `RequestChanges` with persisted entries.

Verification:
- Disconnect/reconnect test verifies `startSequence` > 0 after receiving Changes.

### P1-02: TurnAccepted idempotency recorded before EventLog write
Evidence:
- Idempotency recorded prior to `log.write` in `convertToPayload`.
  `apps/api/src/durable-objects/RoomDurableObject.ts:176`
- If `log.write` fails, retries will be rejected as already accepted.

Impact:
- TurnAccepted or TurnAdvanced can be dropped permanently under transient failures.

Proposed fix:
- Record TurnAccepted idempotency inside the EventLog handler (atomic with
  `journal.write().effect`), or record only after `log.write` succeeds.

Verification:
- Simulate a `log.write` failure and ensure a retry proceeds.

### P1-03: participant_sessions schema migration risk for existing DOs
Evidence:
- Schema adds `room_id` via `CREATE TABLE IF NOT EXISTS` only.
  `apps/api/src/durable-objects/db/schema.ts:66`
- Session code inserts/updates `room_id`.
  `apps/api/src/domain/RoomEventHandlers.ts:417`

Impact:
- Existing DO SQLite tables will not gain the new column, causing runtime SQL errors.

Proposed fix:
- Add explicit ALTER TABLE migration when `room_id` is missing.
- Guard with `PRAGMA table_info(participant_sessions)` before inserts.

Verification:
- Run schema migration on an existing DO db snapshot and assert insert succeeds.

## Implementation Guidance (Order of Operations)
1) Fix roomId/publicKey consistency (P0-01) to unblock protocol correctness.
2) Switch broadcast to storage-backed `EventLogServer.Storage.write` (P1-01).
3) Normalize payload encoding (P0-02) or broadcast from EventLog entries.
4) Move TurnAccepted idempotency into atomic EventLog handler (P1-02).
5) Add schema migration for `participant_sessions.room_id` (P1-03).

## Open Questions
1) Should client event `RoomError.type` remain `"Error"` or be normalized to
   `"RoomError"` for the wire protocol?
2) Should WS broadcast originate strictly from EventLog entries (single source
   of truth), deprecating manual envelope-based broadcasting?

## Test Plan (Minimum)
- WS reconnect replay test (ensures sequences advance).
- ScoreUpdated roundtrip test (envelope -> broadcast -> reducer).
- TurnAccepted retry test (simulate failure then retry).
- Schema migration test for `participant_sessions`.
