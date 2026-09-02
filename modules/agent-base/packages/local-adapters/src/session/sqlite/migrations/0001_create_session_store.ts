import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteSessionTableNames } from '../table-names.js';

export function createSessionStoreMigration(tableNames: SqliteSessionTableNames): string {
  return `
  CREATE TABLE ${quoteSqliteIdentifier(tableNames.sessions)} (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    next_turn_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_turn_sequence >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id)
  ) STRICT;

  CREATE TABLE ${quoteSqliteIdentifier(tableNames.turns)} (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    turn_sequence INTEGER NOT NULL CHECK (turn_sequence >= 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed')),
    user_message TEXT NOT NULL,
    assistant_message TEXT,
    failure_code TEXT,
    started_at INTEGER NOT NULL CHECK (started_at >= 0),
    finished_at INTEGER CHECK (finished_at >= 0),
    PRIMARY KEY (agent_id, session_id, turn_id),
    UNIQUE (agent_id, session_id, turn_sequence),
    FOREIGN KEY (agent_id, session_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.sessions)} (agent_id, session_id)
      ON DELETE CASCADE,
    CHECK (
      (status = 'active' AND assistant_message IS NULL AND failure_code IS NULL AND finished_at IS NULL)
      OR
      (status = 'completed' AND assistant_message IS NOT NULL AND failure_code IS NULL AND finished_at IS NOT NULL)
      OR
      (status = 'failed' AND assistant_message IS NULL AND failure_code IS NOT NULL AND finished_at IS NOT NULL)
    )
  ) STRICT;
`;
}
