CREATE TABLE IF NOT EXISTS source_objects (
  object_key TEXT PRIMARY KEY,
  content_type TEXT,
  size_bytes INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_object_chunks (
  object_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  PRIMARY KEY (object_key, chunk_index),
  FOREIGN KEY (object_key) REFERENCES source_objects(object_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_objects_updated_at
  ON source_objects(updated_at);
