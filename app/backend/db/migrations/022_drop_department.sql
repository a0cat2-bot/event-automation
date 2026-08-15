BEGIN;

-- Removes the applicant department column.
--
-- 018 left name, email and department as the personal data held about an applicant. Department is
-- now gone too: the organisation does not treat it as information this system manages, and the app
-- had never made use of it. The CSV upload demanded it as a required column while the Sally import
-- — the path actually in use — wrote a blank, and no feature read the value back. It was collected
-- and discarded.
--
-- Checked before writing this migration: all 69 rows carried seed values (재무팀, 개발팀 and the
-- like, exactly ten each, plus English development fixtures). No real employee department was
-- stored, so nothing of record is lost here.
--
-- After this migration the only personal data stored about an applicant is name and email.

ALTER TABLE applicants
  DROP COLUMN IF EXISTS department;

COMMIT;
