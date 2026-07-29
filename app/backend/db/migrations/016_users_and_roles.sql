BEGIN;

-- Restores role-based access control, which 004_remove_auth.sql removed.
--
-- Unlike the original DESIGN.md §11 design, this table stores NO credentials. Authentication is
-- delegated to the corporate SSO / reverse proxy (see services/auth); this table only answers
-- "what is this already-authenticated person allowed to do". That keeps password storage out of
-- the application entirely.
--
-- The TEXT attribution columns that 004 left behind (programs.created_by, audit_logs.user_id, …)
-- are deliberately NOT converted back to foreign keys: they hold historical free-text names from
-- the no-auth period, and rewriting them would destroy audit history.

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'coordinator', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role user_role NOT NULL DEFAULT 'coordinator',
  -- Business units this user may act in. An empty array means "all" and is the normal state for
  -- admins; coordinators are expected to have an explicit list.
  business_unit_ids UUID[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Email comparisons are case-insensitive everywhere in the app, so enforce that at the table level
-- rather than relying on every call site to normalise.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users(LOWER(email));

COMMIT;
