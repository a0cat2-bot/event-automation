BEGIN;

-- Fourth per-feature AI switch: generating the mascot/character illustration shown on letters.
--
-- Kept separate from the text features because it uses a different model and endpoint
-- (aipro-image-gen-v1 via /v1/images/generations) with its own rate limit and cost, and because an
-- organisation may reasonably allow AI to draft copy but not to produce imagery that carries its
-- name. Defaults to FALSE like the others.

ALTER TABLE ai_settings
  ADD COLUMN IF NOT EXISTS character_image_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
