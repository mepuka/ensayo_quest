export const queries = {
  insertRoom:
    "INSERT INTO rooms (id, template_id, created_at) VALUES (?, ?, ?)",
  insertTurn:
    "INSERT INTO turns (id, room_id, template_id, turn_index, speaker_user_id, transcript, audio_stats_json, audio_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  selectTurnById:
    "SELECT id, room_id, template_id, turn_index, speaker_user_id, transcript, audio_stats_json FROM turns WHERE id = ?",
  updateTurnAudioKey:
    "UPDATE turns SET audio_key = ? WHERE id = ?",
  selectScenarioTemplateById:
    "SELECT template_json FROM scenario_templates WHERE id = ?",
  updateTurnScore:
    "INSERT INTO turn_scores (turn_id, overall, detail_json) VALUES (?, ?, ?)"
};
