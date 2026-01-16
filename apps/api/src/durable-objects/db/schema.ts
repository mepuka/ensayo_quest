import { Effect } from "effect";
import * as SqlClient from "@effect/sql/SqlClient";

export const roomSchemaSql = `
PRAGMA foreign_keys = ON;

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
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES room_state(room_id)
);

CREATE TABLE IF NOT EXISTS room_turn_scores (
  turn_id TEXT PRIMARY KEY,
  overall INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES room_turns(turn_id)
);

CREATE TABLE IF NOT EXISTS room_turn_prompts (
  turn_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES room_turns(turn_id)
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
  user_id TEXT NOT NULL,
  connected_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_participant_sessions_user_id ON participant_sessions(user_id);
`;

export const applyRoomSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const statement of roomSchemaSql.split(";")) {
    const trimmed = statement.trim();
    if (!trimmed) continue;
    yield* sql.unsafe(trimmed).withoutTransform;
  }
});
