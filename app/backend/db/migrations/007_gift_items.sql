BEGIN;

CREATE TABLE IF NOT EXISTS gift_items (
  id UUID PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(512),
  quantity INT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gift_items_program_id ON gift_items(program_id);

ALTER TABLE gift_recipients
  ADD COLUMN IF NOT EXISTS gift_item_id UUID REFERENCES gift_items(id);

COMMIT;
