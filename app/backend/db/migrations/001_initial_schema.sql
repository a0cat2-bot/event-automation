BEGIN;

-- PostgreSQL-compatible named equivalents of the inline ENUM declarations in DESIGN.md §3.
-- CREATE TYPE has no IF NOT EXISTS clause, so each is wrapped in a DO block that
-- swallows duplicate_object, making the migration safe to re-run against a
-- volume that already has the schema applied.
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'coordinator', 'viewer');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE template_type AS ENUM ('recruitment', 'notification', 'gift_notification');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE output_format AS ENUM ('pdf', 'image');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE selection_mode AS ENUM ('first_come_first_served', 'score', 'written_justification');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE program_status AS ENUM ('planning', 'recruitment_active', 'selection_in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'bounced', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE survey_status AS ENUM ('not_sent', 'sent', 'in_progress', 'completed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE participant_gift_status AS ENUM ('not_selected', 'selected', 'delivered');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE gift_recipient_status AS ENUM ('selected', 'delivered', 'failed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Tables are ordered to satisfy PostgreSQL foreign-key creation requirements. All
-- columns, defaults, constraints, and indexes below correspond to DESIGN.md §3.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role user_role DEFAULT 'coordinator',
  business_units TEXT[],
  hashed_password VARCHAR(255),
  last_login TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS letter_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  template_type template_type,
  brand_variant VARCHAR(50),
  body TEXT NOT NULL,
  brand_assets JSONB,
  output_format output_format DEFAULT 'pdf',
  version INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_letter_templates_name ON letter_templates(name);

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  business_unit VARCHAR(100) NOT NULL,
  intake_data JSONB,
  template_version_id UUID REFERENCES letter_templates(id),
  selection_mode selection_mode,
  max_participants INT,
  status program_status,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  deleted_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS applicants (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  external_id VARCHAR(50),
  email VARCHAR(255),
  name VARCHAR(255),
  department VARCHAR(100),
  score INT,
  justification TEXT,
  applied_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(program_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_applicants_program_id ON applicants(program_id);

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  applicant_id UUID NOT NULL REFERENCES applicants(id),
  selection_rank INT,
  selection_reason VARCHAR(255),
  notification_status notification_status DEFAULT 'pending',
  notification_sent_at TIMESTAMP NULL,
  notification_letter_id UUID,
  survey_id VARCHAR(100),
  survey_status survey_status DEFAULT 'not_sent',
  is_gift_eligible BOOLEAN DEFAULT TRUE,
  gift_status participant_gift_status DEFAULT 'not_selected',
  gift_selected_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(program_id, applicant_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_program_id ON participants(program_id);
CREATE INDEX IF NOT EXISTS idx_participants_survey_status ON participants(survey_status);

CREATE TABLE IF NOT EXISTS generated_letters (
  id UUID PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES letter_templates(id),
  program_id UUID NOT NULL REFERENCES programs(id),
  applicant_id UUID NOT NULL REFERENCES applicants(id),
  file_path VARCHAR(512),
  file_size_bytes INT,
  content_hash VARCHAR(64),
  generated_at TIMESTAMP DEFAULT NOW(),
  generated_by UUID REFERENCES users(id),
  template_variables_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_generated_letters_program_id ON generated_letters(program_id);

DO $$ BEGIN
    ALTER TABLE participants
      ADD CONSTRAINT participants_notification_letter_id_fkey
      FOREIGN KEY (notification_letter_id) REFERENCES generated_letters(id);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS survey_results (
  id UUID PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id),
  program_id UUID NOT NULL REFERENCES programs(id),
  sally_survey_id VARCHAR(100),
  completion_date TIMESTAMP,
  responses JSONB,
  satisfaction_score INT,
  feedback_text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(participant_id, sally_survey_id)
);

CREATE INDEX IF NOT EXISTS idx_survey_results_program_id ON survey_results(program_id);

CREATE TABLE IF NOT EXISTS gift_recipients (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  selection_rank INT,
  selection_reason VARCHAR(255),
  selected_at TIMESTAMP DEFAULT NOW(),
  selected_by UUID REFERENCES users(id),
  gift_status gift_recipient_status DEFAULT 'selected',
  delivery_date TIMESTAMP NULL,
  delivery_method VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(program_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_recipients_program_id ON gift_recipients(program_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  action VARCHAR(100),
  entity_type VARCHAR(50),
  entity_id UUID,
  program_id UUID REFERENCES programs(id),
  details JSONB,
  ip_address INET,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_program_id ON audit_logs(program_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

COMMIT;
