CREATE TABLE round_jobs_new (
  round_id TEXT PRIMARY KEY REFERENCES rounds(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'cancel_requested')),
  claimed_by TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (status = 'queued' AND claimed_by IS NULL AND claimed_at IS NULL) OR
    (status = 'claimed' AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL) OR
    (status = 'cancel_requested' AND (
      (claimed_by IS NULL AND claimed_at IS NULL) OR
      (claimed_by IS NOT NULL AND claimed_at IS NOT NULL)
    ))
  )
);

INSERT INTO round_jobs_new (round_id, status, claimed_by, claimed_at, created_at, updated_at)
SELECT round_id, status, claimed_by, claimed_at, created_at, updated_at FROM round_jobs;

DROP TABLE round_jobs;
ALTER TABLE round_jobs_new RENAME TO round_jobs;
CREATE INDEX round_jobs_status_created_idx ON round_jobs(status, created_at);
