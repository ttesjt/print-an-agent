import type { SqliteSessionTableNames } from '../table-names.js';
import { quoteSqliteIdentifier, sessionRetirementIndexName } from '../table-names.js';

export function createSessionStoreMigration(tableNames: SqliteSessionTableNames): string {
  return `
  CREATE TABLE ${quoteSqliteIdentifier(tableNames.sessions)} (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL UNIQUE,
    next_turn_sequence INTEGER NOT NULL DEFAULT 0 CHECK (next_turn_sequence >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    lifecycle_status TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_status IN ('active', 'retired')),
    retired_at INTEGER CHECK (retired_at >= 0),
    execution_revision INTEGER NOT NULL DEFAULT 0 CHECK (execution_revision >= 0),
    execution_state TEXT NOT NULL DEFAULT 'ready' CHECK (execution_state IN ('ready', 'recovering')),
    execution_leases TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(execution_leases)),
    CHECK ((lifecycle_status = 'active' AND retired_at IS NULL) OR
           (lifecycle_status = 'retired' AND retired_at IS NOT NULL)),
    PRIMARY KEY (agent_id, session_id)
  ) STRICT;

  CREATE INDEX ${quoteSqliteIdentifier(sessionRetirementIndexName(tableNames))}
    ON ${quoteSqliteIdentifier(tableNames.sessions)}
    (agent_id, lifecycle_status, retired_at DESC, session_id);

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
    presentation TEXT CHECK (presentation IS NULL OR status = 'completed'),
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
