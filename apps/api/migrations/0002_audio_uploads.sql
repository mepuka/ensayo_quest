-- Audio upload idempotency tables (Architecture Invariant #2)
-- @see docs/plans/2026-01-16-frontend-voice-stack-design.md - Section 5

-- Per-turn audio upload tracking (prevents re-upload with different requestId)
-- Only one audio file is allowed per turn
CREATE TABLE IF NOT EXISTS audio_uploads (
  turn_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  content_type TEXT,
  file_size_bytes INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);

-- Request-level idempotency for audio uploads
-- Same requestId returns cached result (handles retries)
CREATE TABLE IF NOT EXISTS audio_upload_requests (
  turn_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  audio_key TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  PRIMARY KEY (turn_id, request_id),
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);

-- Index for request-level lookups
CREATE INDEX IF NOT EXISTS idx_audio_upload_requests_lookup ON audio_upload_requests(turn_id, request_id);

-- Scoring enqueue idempotency (prevents duplicate scoring jobs on event replay)
-- Architecture Invariant #9: Scoring enqueue gated on AudioUploaded
CREATE TABLE IF NOT EXISTS audio_scoring_enqueued (
  turn_id TEXT PRIMARY KEY,
  audio_key TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(id)
);
