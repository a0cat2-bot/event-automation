BEGIN;

-- Removes the applicant identifier column and makes email the identity key.
--
-- `external_id` was labelled 사번 (employee number) in the applicant-upload UI, which is personal
-- information the organisation does not permit this system to hold. In practice the values arriving
-- through the Sally path were Knox IDs (email identifiers) rather than employee numbers, so the
-- column was mislabelled rather than genuinely holding 사번 — but it is removed either way, since
-- email already identifies an applicant uniquely and is required to send letters at all.
--
-- After this migration the only personal data stored about an applicant is name, email and
-- department.

-- The old uniqueness rule was (program_id, external_id); email takes over that role. Compared
-- case-insensitively because the same person may submit "A@x.com" and "a@x.com" across intakes.
ALTER TABLE applicants
  DROP CONSTRAINT IF EXISTS applicants_program_id_external_id_key;

ALTER TABLE applicants
  DROP COLUMN IF EXISTS external_id;

-- Email is now the identity key, so it can no longer be absent. Verified before writing this
-- migration that no existing row has a null or blank email.
UPDATE applicants SET email = NULL WHERE BTRIM(email) = '';

ALTER TABLE applicants
  ALTER COLUMN email SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS applicants_program_email_key
  ON applicants (program_id, LOWER(email));

COMMIT;
