export const roomQueries = {
  upsertRoomState:
    "INSERT INTO room_state (room_id, state_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
  insertTurn:
    "INSERT INTO room_turns (turn_id, room_id, turn_index, speaker_user_id, transcript, audio_stats_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  upsertTurnScore:
    "INSERT INTO room_turn_scores (turn_id, overall, detail_json, status, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(turn_id) DO UPDATE SET overall = excluded.overall, detail_json = excluded.detail_json, status = excluded.status, updated_at = excluded.updated_at",
  upsertTurnPrompt:
    "INSERT INTO room_turn_prompts (turn_id, prompt, updated_at) VALUES (?, ?, ?) ON CONFLICT(turn_id) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at"
};
