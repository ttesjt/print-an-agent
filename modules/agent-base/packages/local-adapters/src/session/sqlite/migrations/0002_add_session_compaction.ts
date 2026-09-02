import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteSessionTableNames } from '../table-names.js';

export function addSessionCompactionMigration(tableNames: SqliteSessionTableNames): string {
  return `
  CREATE TABLE ${quoteSqliteIdentifier(tableNames.compactions)} (
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    through_turn_id TEXT NOT NULL,
    context_message TEXT NOT NULL,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    PRIMARY KEY (agent_id, session_id),
    FOREIGN KEY (agent_id, session_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.sessions)} (agent_id, session_id)
      ON DELETE CASCADE,
    FOREIGN KEY (agent_id, session_id, through_turn_id)
      REFERENCES ${quoteSqliteIdentifier(tableNames.turns)} (agent_id, session_id, turn_id)
  ) STRICT;
`;
}
