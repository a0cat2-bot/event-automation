BEGIN;

-- CREATE TYPE has no IF NOT EXISTS clause, so swallow duplicate_object to keep
-- this migration safe to re-run against an already-migrated database.
DO $$ BEGIN
    CREATE TYPE letter_layout_mode AS ENUM ('freeform', 'standard');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS letter_categories (
  id UUID PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  has_datetime BOOLEAN NOT NULL DEFAULT FALSE,
  has_location BOOLEAN NOT NULL DEFAULT FALSE,
  has_gift_info BOOLEAN NOT NULL DEFAULT FALSE,
  has_precautions BOOLEAN NOT NULL DEFAULT FALSE,
  has_cta_link BOOLEAN NOT NULL DEFAULT FALSE,
  default_title_text VARCHAR(255) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_letter_categories_sort_order
  ON letter_categories(sort_order);

INSERT INTO letter_categories
  (id, slug, display_name, has_datetime, has_location, has_gift_info,
   has_precautions, has_cta_link, default_title_text, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'recruitment_with_gift', '모집 안내 - 상품 있음', TRUE, TRUE, TRUE, TRUE, TRUE, '참여 모집 안내', 0),
  ('00000000-0000-4000-8000-000000000002', 'recruitment_participation_win', '모집 안내 - 참여 자체가 당첨', TRUE, TRUE, FALSE, TRUE, TRUE, '참여 모집 안내', 1),
  ('00000000-0000-4000-8000-000000000003', 'selection_notice', '당첨/참여 확정 안내', TRUE, TRUE, FALSE, TRUE, FALSE, '당첨을 축하드립니다', 2),
  ('00000000-0000-4000-8000-000000000004', 'gift_pickup_notice', '상품 수령 안내', TRUE, TRUE, TRUE, TRUE, FALSE, '상품 수령 안내', 3),
  ('00000000-0000-4000-8000-000000000005', 'participation_detail_notice', '참여 상세 안내', TRUE, TRUE, FALSE, TRUE, FALSE, '참여 안내', 4),
  ('00000000-0000-4000-8000-000000000006', 'non_selection_notice', '미당첨 안내', FALSE, FALSE, FALSE, FALSE, FALSE, '참여해주셔서 감사합니다', 5),
  ('00000000-0000-4000-8000-000000000007', 'satisfaction_survey', '만족도 설문', FALSE, FALSE, TRUE, FALSE, TRUE, '만족도 설문 참여 안내', 6)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS org_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  character_image_url VARCHAR(512),
  org_display_name VARCHAR(255) NOT NULL DEFAULT 'AX센터 EHS그룹',
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  CONSTRAINT org_settings_singleton CHECK (id)
);

INSERT INTO org_settings (id)
VALUES (TRUE)
ON CONFLICT (id) DO NOTHING;

-- standard_content JSON shape:
-- {
--   title_override: string | null,
--   datetime_text: string | null,
--   location_text: string | null,
--   body_text: string,
--   gift_info_text: string | null,
--   precautions: string[],
--   cta_text: string | null,
--   cta_link: string | null
-- }
-- body_text merge fields use {{key}} with these letterPlaceholderKey values:
-- applicant_name, applicant_email, department, program_name, program_date,
-- program_location, program_time, survey_link, gift_amount, coordinator_name,
-- coordinator_contact. The static key remains a freeform-only literal.
ALTER TABLE letter_templates
  ADD COLUMN IF NOT EXISTS layout_mode letter_layout_mode NOT NULL DEFAULT 'freeform',
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES letter_categories(id),
  ADD COLUMN IF NOT EXISTS standard_content JSONB;

CREATE INDEX IF NOT EXISTS idx_letter_templates_category_id
  ON letter_templates(category_id);

COMMIT;
