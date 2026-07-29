BEGIN;

UPDATE letter_categories SET display_name = '상품수령안내' WHERE slug = 'gift_pickup_notice';
UPDATE letter_categories SET display_name = '미당첨 안내' WHERE slug = 'non_selection_notice';
UPDATE letter_categories SET display_name = '참여 안내' WHERE slug = 'participation_detail_notice';
UPDATE letter_categories SET display_name = '참여모집안내' WHERE slug = 'recruitment_participation_win';
UPDATE letter_categories SET display_name = '만족도 설문' WHERE slug = 'satisfaction_survey';
UPDATE letter_categories SET display_name = '당첨 안내' WHERE slug = 'selection_notice';

COMMIT;
