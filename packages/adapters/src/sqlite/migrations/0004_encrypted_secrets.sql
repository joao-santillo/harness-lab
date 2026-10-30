CREATE TABLE encrypted_secrets (
  id TEXT PRIMARY KEY,
  key_version INTEGER NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);