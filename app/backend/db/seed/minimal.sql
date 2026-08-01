BEGIN;

INSERT INTO business_units (id, name, is_active)
VALUES ('00000000-0000-4000-8000-000000000101', 'Default', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO letter_categories
  (id, slug, display_name, has_datetime, has_location, has_gift_info,
   has_precautions, has_cta_link, default_title_text, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'recruitment_with_gift', '참여모집안내 (상품 있음)', TRUE, TRUE, TRUE, TRUE, TRUE, '참여 모집 안내', 0),
  ('00000000-0000-4000-8000-000000000002', 'recruitment_participation_win', '참여모집안내', TRUE, TRUE, FALSE, TRUE, TRUE, '참여 모집 안내', 1),
  ('00000000-0000-4000-8000-000000000003', 'selection_notice', '당첨 안내', TRUE, TRUE, FALSE, TRUE, FALSE, '당첨을 축하드립니다', 2),
  ('00000000-0000-4000-8000-000000000004', 'gift_pickup_notice', '상품수령안내', TRUE, TRUE, TRUE, TRUE, FALSE, '상품 수령 안내', 3),
  ('00000000-0000-4000-8000-000000000005', 'participation_detail_notice', '참여 안내', TRUE, TRUE, FALSE, TRUE, FALSE, '참여 안내', 4),
  ('00000000-0000-4000-8000-000000000006', 'non_selection_notice', '미당첨 안내', FALSE, FALSE, FALSE, FALSE, FALSE, '참여해주셔서 감사합니다', 5),
  ('00000000-0000-4000-8000-000000000007', 'satisfaction_survey', '만족도 설문', FALSE, FALSE, TRUE, FALSE, TRUE, '만족도 설문 참여 안내', 6)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO org_settings (business_unit, org_display_name)
VALUES ('', 'Your Organization')
ON CONFLICT (business_unit) DO NOTHING;

COMMIT;
