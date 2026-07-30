BEGIN;

-- Per-feature AI switches — the INNER of two gates.
--
-- The outer gate is LLM_PROVIDER in the environment: operator-controlled, not editable from the
-- UI, and answers "may this deployment call an LLM at all". This table answers the narrower
-- question "which features are allowed to use it", and is editable by an admin in the app.
--
-- Kept separate from org_settings because that table is scoped per business unit, whereas
-- enabling AI is an organisation-wide governance decision. Every flag defaults to FALSE so that
-- applying this migration changes no behaviour on its own.
--
-- Flags are individual columns rather than a JSONB blob so that adding a feature is a visible
-- schema change subject to review, not a silent write.

CREATE TABLE IF NOT EXISTS ai_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  -- Scores written justifications and produces a rationale for each candidate. Affects who is
  -- selected, so the coordinator still makes the final decision.
  justification_screening_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Drafts letter body copy for a category. Advisory only; the draft is editable before sending.
  letter_copy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Summarises free-text survey answers into themes for the results report. Read-only analysis.
  survey_summary_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT ai_settings_singleton CHECK (id)
);

INSERT INTO ai_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

COMMIT;
