BEGIN;

UPDATE letter_categories SET display_name = '참여모집안내 (상품 있음)' WHERE slug = 'recruitment_with_gift';

COMMIT;
