BEGIN;

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS business_unit VARCHAR(100);

-- The former singleton row becomes the default/fallback row without changing
-- any of its visible settings.
UPDATE org_settings
SET business_unit = ''
WHERE business_unit IS NULL;

ALTER TABLE org_settings
  ALTER COLUMN business_unit SET DEFAULT '',
  ALTER COLUMN business_unit SET NOT NULL,
  DROP CONSTRAINT IF EXISTS org_settings_singleton,
  DROP CONSTRAINT IF EXISTS org_settings_pkey,
  DROP COLUMN IF EXISTS id;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'org_settings_business_unit_key'
      AND conrelid = 'org_settings'::regclass
  ) THEN
    ALTER TABLE org_settings
      ADD CONSTRAINT org_settings_business_unit_key UNIQUE (business_unit);
  END IF;
END $$;

-- This only inserts when the former singleton row was missing. On normal
-- upgrades, the UPDATE above preserves that row's name, image, and contacts.
INSERT INTO org_settings (business_unit)
VALUES ('')
ON CONFLICT (business_unit) DO NOTHING;

COMMIT;
