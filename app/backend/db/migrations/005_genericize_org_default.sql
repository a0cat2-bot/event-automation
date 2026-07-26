BEGIN;

ALTER TABLE org_settings
  ALTER COLUMN org_display_name SET DEFAULT 'Your Organization';

COMMIT;
