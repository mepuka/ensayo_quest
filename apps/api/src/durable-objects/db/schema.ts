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
`;
