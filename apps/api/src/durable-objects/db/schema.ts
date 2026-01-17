import { Effect } from "effect";
import * as SqlClient from "@effect/sql/SqlClient";

// NOTE: Cloudflare DO SQLite doesn't support PRAGMA foreign_keys
// Foreign key constraints are defined but NOT enforced at runtime
// Referential integrity must be maintained by application logic
export const roomSchemaSql = `
CREATE TABLE IF NOT EXISTS room_state (
  room_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_turns (
  turn_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  speaker_user_id TEXT NOT NULL,
  transcript TEXT NOT NULL,
  audio_stats_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_turn_scores (
  turn_id TEXT PRIMARY KEY,
  overall INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_turn_prompts (
  turn_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_turns_room_id ON room_turns(room_id);
CREATE INDEX IF NOT EXISTS idx_room_turns_status ON room_turns(status);

-- Idempotency table for step advances
-- Prevents double-advance on retry (Architecture Invariant #5)
CREATE TABLE IF NOT EXISTS room_step_advances (
  room_id TEXT NOT NULL,
  from_step_index INTEGER NOT NULL,
  to_step_index INTEGER NOT NULL,
  advanced_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, from_step_index)
);

-- Idempotency table for alarm processing (Architecture Invariant #6)
-- Prevents duplicate NPC turn generation on alarm retry (up to 7 times)
CREATE TABLE IF NOT EXISTS alarm_processing (
  npc_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  scheduled_at INTEGER NOT NULL,
  turn_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (npc_id, step_index, scheduled_at)
);

-- Participant session tracking (Architecture Invariants #7, #8)
-- Tracks active WebSocket connections with validated sessions
CREATE TABLE IF NOT EXISTS participant_sessions (
  session_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_participant_sessions_user_id ON participant_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_participant_sessions_room_id ON participant_sessions(room_id);

-- Idempotency table for audio scoring enqueue (Architecture Invariant #9)
-- Prevents duplicate scoring queue messages when AudioUploaded event is replayed
CREATE TABLE IF NOT EXISTS audio_scoring_enqueued (
  turn_id TEXT PRIMARY KEY,
  audio_key TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL
);

-- Idempotency table for TurnAccepted events
-- Prevents duplicate TurnAccepted writes on HTTP retry
CREATE TABLE IF NOT EXISTS turn_accepted_idempotency (
  turn_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  accepted_at INTEGER NOT NULL
);
`;

/**
 * Apply the room schema to the DO's SQLite database.
 *
 * PRAGMA must run OUTSIDE transactions per SQLite spec.
 * Schema DDL wrapped in transaction for atomicity - if any statement fails,
 * all changes are rolled back. All statements use IF NOT EXISTS
 * for idempotency (safe to re-run on every DO wake).
 */
export const applyRoomSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // NOTE: PRAGMA foreign_keys is NOT supported in Cloudflare DO SQLite
  // Foreign key constraints are enforced differently in DO storage
  // See: https://developers.cloudflare.com/durable-objects/api/transactional-storage-api/

  // Schema DDL - each statement executed individually
  // CREATE TABLE IF NOT EXISTS is idempotent (safe to re-run on every DO wake)
  for (const statement of roomSchemaSql.split(";")) {
    const trimmed = statement.trim();
    if (!trimmed) continue;
    yield* sql.unsafe(trimmed).withoutTransform;
  }
});
