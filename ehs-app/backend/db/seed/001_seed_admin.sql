-- LOCAL DEVELOPMENT ONLY. Never reuse this account or password in production.
INSERT INTO users (id, email, name, role, business_units, hashed_password)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'admin@ehs.local',
  'Local Admin',
  'admin',
  ARRAY['Engineering', 'Sales', 'HR'],
  '$2y$12$HxOuemZwKhNWoFRl3wNl7ObA.CTveHQI3B1NrnS9AI/7pKjY/3kES'
)
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  business_units = EXCLUDED.business_units,
  hashed_password = EXCLUDED.hashed_password,
  is_active = TRUE,
  updated_at = NOW();
