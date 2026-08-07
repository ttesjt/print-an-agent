export const CREATE_REQUEST_JOURNAL_MIGRATION = `
  CREATE TABLE ta_agent_base_request_journal_entries (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    request_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
    response_json TEXT,
    failure_code TEXT,
    failure_message TEXT,
    started_at INTEGER NOT NULL CHECK (started_at >= 0),
    finished_at INTEGER CHECK (finished_at >= 0),
    PRIMARY KEY (agent_id, session_id, idempotency_key),
    CHECK (
      (status = 'active' AND response_json IS NULL AND failure_code IS NULL
        AND failure_message IS NULL AND finished_at IS NULL)
      OR
      (status = 'completed' AND response_json IS NOT NULL AND failure_code IS NULL
        AND failure_message IS NULL AND finished_at IS NOT NULL)
      OR
      (status = 'failed' AND response_json IS NULL AND failure_code IS NOT NULL
        AND failure_message IS NOT NULL AND finished_at IS NOT NULL)
    )
  ) STRICT;
`;
