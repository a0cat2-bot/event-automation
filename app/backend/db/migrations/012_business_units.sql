BEGIN;

CREATE TABLE IF NOT EXISTS business_units (
  id UUID PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_units_name_key'
      AND conrelid = 'business_units'::regclass
  ) THEN
    ALTER TABLE business_units
      ADD CONSTRAINT business_units_name_key UNIQUE (name);
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'programs'
      AND column_name = 'business_unit'
  ) THEN
    EXECUTE $sql$
      INSERT INTO business_units (id, name)
      SELECT gen_random_uuid(), business_unit
      FROM (
        SELECT DISTINCT business_unit
        FROM programs
        WHERE BTRIM(business_unit) <> ''
      ) existing_business_units
      ON CONFLICT (name) DO NOTHING
    $sql$;
  END IF;
END $$;

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS business_unit_id UUID REFERENCES business_units(id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'programs'
      AND column_name = 'business_unit'
  ) THEN
    EXECUTE $sql$
      UPDATE programs p
      SET business_unit_id = bu.id
      FROM business_units bu
      WHERE p.business_unit = bu.name
        AND p.business_unit_id IS NULL
    $sql$;
  END IF;
END $$;

ALTER TABLE programs
  ALTER COLUMN business_unit_id SET NOT NULL;

ALTER TABLE programs
  DROP COLUMN IF EXISTS business_unit;

COMMIT;
