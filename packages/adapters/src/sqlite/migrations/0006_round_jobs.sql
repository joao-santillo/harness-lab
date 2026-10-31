CREATE TABLE round_jobs (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'cancel_requested')),
  claimed_by TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'claimed' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL) OR
    (status != 'claimed' AND claimed_by IS NULL AND claimed_at IS NULL)
  )
);

CREATE INDEX round_jobs_status_created_idx ON round_jobs(status, created_at);