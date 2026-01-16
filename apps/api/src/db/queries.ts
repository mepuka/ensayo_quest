export const queries = {
  insertRoom:
    "INSERT INTO rooms (id, template_id, created_at) VALUES (?, ?, ?)",
  selectRoomTemplateId:
    "SELECT template_id FROM rooms WHERE id = ?",
  insertTurn:
    "INSERT INTO turns (id, room_id, template_id, turn_index, speaker_user_id, transcript, audio_stats_json, audio_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  selectTurnById:
    "SELECT id, room_id, template_id, turn_index, speaker_user_id, transcript, audio_stats_json FROM turns WHERE id = ?",
  selectNextTurnIndex:
    "SELECT COALESCE(MAX(turn_index) + 1, 0) as next_index FROM turns WHERE room_id = ?",
  updateTurnAudioKey:
    "UPDATE turns SET audio_key = ? WHERE id = ?",
  selectScenarioTemplateById:
    "SELECT template_json FROM scenario_templates WHERE id = ?",
  selectScenarioTemplateByTopicLevel:
    "SELECT template_json FROM scenario_templates WHERE topic = ? AND level = ? LIMIT 1",
  updateTurnScore:
    "INSERT INTO turn_scores (turn_id, overall, detail_json) VALUES (?, ?, ?) ON CONFLICT(turn_id) DO UPDATE SET overall = excluded.overall, detail_json = excluded.detail_json",
  // Queue idempotency
  checkMessageProcessed:
    "SELECT 1 FROM processed_queue_messages WHERE id = ?",
  markMessageProcessed:
    "INSERT INTO processed_queue_messages (id, processed_at) VALUES (?, ?)",
  cleanupOldProcessedMessages:
    "DELETE FROM processed_queue_messages WHERE processed_at < ?",
  // Turn request idempotency (Architecture Invariant #2)
  getTurnByRequestId:
    "SELECT turn_id FROM turn_requests WHERE room_id = ? AND request_id = ?",
  recordTurnRequest:
    "INSERT INTO turn_requests (room_id, request_id, turn_id, created_at) VALUES (?, ?, ?, ?)"
};
