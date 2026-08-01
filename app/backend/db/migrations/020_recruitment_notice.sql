BEGIN;

-- Sally's created recruitment-survey URL belongs to the program cycle that will advertise it.
-- It stays nullable because older and planning programs may not have created a survey yet.
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS recruitment_survey_url VARCHAR(2048) NULL;

-- Manual recruitment recipients are edited as one list per program. A row per address keeps the
-- uniqueness rule in PostgreSQL instead of burying it in JSON, matching applicants' email identity.
CREATE TABLE IF NOT EXISTS recruitment_recipients (
  program_id UUID NOT NULL REFERENCES programs(id),
  email VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS recruitment_recipients_program_email_key
  ON recruitment_recipients (program_id, LOWER(email));

COMMIT;
