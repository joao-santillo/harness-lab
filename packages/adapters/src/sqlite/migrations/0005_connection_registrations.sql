CREATE TABLE connection_registrations (
  id TEXT PRIMARY KEY REFERENCES encrypted_secrets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);