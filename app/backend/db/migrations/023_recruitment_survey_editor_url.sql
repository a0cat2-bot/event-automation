BEGIN;

-- Keeps the draft's editor address apart from the link employees receive.
--
-- These are two different pages and conflating them mailed people a URL only the coordinator can
-- open. `recruitment_survey_url` stays what it has always claimed to be — the public survey
-- address, which Sally only mints at distribution — and the editor page the app creates gets its
-- own column, so distribution can find the draft again after a reload without guessing by title.
--
-- Nullable because a programme may have a draft and no distribution, a distribution made by hand
-- in Sally and no stored draft, or neither.

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS recruitment_survey_editor_url TEXT;

COMMIT;
