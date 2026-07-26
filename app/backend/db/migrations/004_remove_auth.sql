BEGIN;

-- Preserve former user references as optional free-text attribution notes before
-- removing the users table. PostgreSQL's generated foreign-key names follow the
-- <table>_<column>_fkey convention used by the earlier migrations.
ALTER TABLE programs
  DROP CONSTRAINT IF EXISTS programs_created_by_fkey,
  ALTER COLUMN created_by TYPE TEXT USING created_by::text;

ALTER TABLE letter_templates
  DROP CONSTRAINT IF EXISTS letter_templates_created_by_fkey,
  ALTER COLUMN created_by TYPE TEXT USING created_by::text;

ALTER TABLE generated_letters
  DROP CONSTRAINT IF EXISTS generated_letters_generated_by_fkey,
  ALTER COLUMN generated_by TYPE TEXT USING generated_by::text;

ALTER TABLE org_settings
  DROP CONSTRAINT IF EXISTS org_settings_updated_by_fkey,
  ALTER COLUMN updated_by TYPE TEXT USING updated_by::text,
  ADD COLUMN IF NOT EXISTS default_coordinator_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS default_coordinator_contact VARCHAR(255);

ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey,
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE gift_recipients
  DROP CONSTRAINT IF EXISTS gift_recipients_selected_by_fkey,
  ALTER COLUMN selected_by TYPE TEXT USING selected_by::text;

DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_role;

COMMIT;
