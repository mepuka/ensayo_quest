export const queries = {
  insertRoom:
    "INSERT INTO rooms (id, template_id, created_at) VALUES (?, ?, ?)",
  insertTurn:
    "INSERT INTO turns (id, room_id, speaker_user_id, transcript, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  updateTurnScore:
    "INSERT INTO turn_scores (turn_id, overall, detail_json) VALUES (?, ?, ?)"
};
