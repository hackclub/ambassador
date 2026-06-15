-- Soft delete: reads filter on deleted_at IS NULL; uniqueness checks scan all rows so ids/codes/tokens stay reserved.
ALTER TABLE posters
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_posters_deleted_at ON posters (deleted_at);
