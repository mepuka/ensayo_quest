-- Room request idempotency table
-- @see docs/ARCHITECTURE.md - Invariant #10: Room creation idempotent via requestId

CREATE TABLE IF NOT EXISTS room_requests (
  request_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_requests_room_id ON room_requests(room_id);
