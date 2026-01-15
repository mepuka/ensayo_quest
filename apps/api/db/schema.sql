PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  speaker_user_id TEXT NOT NULL,
  transcript TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS turn_scores (
  turn_id TEXT PRIMARY KEY,
  overall INTEGER NOT NULL,
  detail_json TEXT NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);

CREATE TABLE IF NOT EXISTS scenario_templates (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  level TEXT NOT NULL,
  region TEXT NOT NULL,
  register TEXT NOT NULL,
  template_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  text TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vocab_items (
  id TEXT PRIMARY KEY,
  lemma TEXT NOT NULL,
  pos TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turns_room_id ON turns(room_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_source_id ON kb_chunks(source_id);
