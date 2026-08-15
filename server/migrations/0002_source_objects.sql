CREATE TABLE IF NOT EXISTS source_objects (
  object_key TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_objects_updated_at
  ON source_objects(updated_at);
