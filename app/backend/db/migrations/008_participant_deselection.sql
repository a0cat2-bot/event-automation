BEGIN;

ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS deselected_at TIMESTAMP NULL,
  ADD COLUMN IF NOT EXISTS deselection_reason VARCHAR(255) NULL;

CREATE INDEX IF NOT EXISTS idx_participants_deselected_at ON participants(deselected_at);

COMMIT;
