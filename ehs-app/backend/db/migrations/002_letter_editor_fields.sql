BEGIN;

-- text_fields is a JSON array of objects with this shape:
-- {
--   id: string,
--   key: applicant_name | applicant_email | department | program_name |
--        program_date | program_location | program_time | survey_link |
--        gift_amount | coordinator_name | coordinator_contact | static,
--   static_text: string | null,
--   x: number, y: number, width: number, height: number,
--   font_family: string, font_size: number, font_weight: string,
--   color: hex string,
--   text_align: left | center | right
-- }
ALTER TABLE letter_templates
  ADD COLUMN IF NOT EXISTS background_image_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS canvas_width INT,
  ADD COLUMN IF NOT EXISTS canvas_height INT,
  ADD COLUMN IF NOT EXISTS text_fields JSONB;

-- PostgreSQL treats DROP NOT NULL as a no-op when the constraint is already absent.
ALTER TABLE letter_templates ALTER COLUMN body DROP NOT NULL;

COMMIT;
