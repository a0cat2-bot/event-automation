CREATE TABLE IF NOT EXISTS program_letter_customizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id),
  template_id UUID NOT NULL REFERENCES letter_templates(id),
  standard_content JSONB,
  text_fields JSONB,
  background_image_url VARCHAR(512),
  canvas_width INT,
  canvas_height INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(program_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_program_letter_customizations_program_id
  ON program_letter_customizations(program_id);
