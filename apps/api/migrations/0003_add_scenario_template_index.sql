-- Add composite index on scenario_templates for topic/level lookups
-- Query: SELECT template_json FROM scenario_templates WHERE topic = ? AND level = ? LIMIT 1

CREATE INDEX IF NOT EXISTS idx_scenario_templates_topic_level
  ON scenario_templates(topic, level);
