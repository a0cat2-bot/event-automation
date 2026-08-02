BEGIN;

-- Sally browser storage is a credential, so each coordinator gets one encrypted row keyed by the
-- authenticated email address. The application supplies AES-256-GCM ciphertext only; passwords
-- and readable Playwright storage state never belong in this table.
CREATE TABLE IF NOT EXISTS sally_sessions (
  user_email VARCHAR(255) PRIMARY KEY,
  encrypted_storage_state TEXT NOT NULL,
  stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
