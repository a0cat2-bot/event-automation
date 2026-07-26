BEGIN;

-- CREATE TYPE has no IF NOT EXISTS clause, so swallow duplicate_object to keep
-- this migration safe to re-run against an already-migrated database.
DO $$ BEGIN
    CREATE TYPE report_format AS ENUM ('markdown', 'html', 'pdf');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS results_reports (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  format report_format NOT NULL,
  content TEXT,
  file_path VARCHAR(500),
  summary JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_reports_program_id
  ON results_reports(program_id);

COMMIT;
