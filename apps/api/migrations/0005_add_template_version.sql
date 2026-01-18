-- Add template_version to scenario_templates for replay integrity
ALTER TABLE scenario_templates
  ADD COLUMN template_version TEXT NOT NULL DEFAULT '';
