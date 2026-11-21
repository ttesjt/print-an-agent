import { quoteSqliteIdentifier as quote, sessionMemoryTable } from '../../table-names.js';
import type { SqliteSessionTableNames } from '../../types/table-names.js';

export function sessionMemoryMigration(names: SqliteSessionTableNames): string {
  return `CREATE TABLE ${quote(sessionMemoryTable(names))} (
    agent_id TEXT NOT NULL, session_id TEXT NOT NULL, kind TEXT NOT NULL,
    id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
    settled INTEGER NOT NULL CHECK(settled IN (0,1)), value TEXT NOT NULL CHECK(json_valid(value)),
    PRIMARY KEY(agent_id, session_id, kind, id),
    FOREIGN KEY(agent_id,session_id) REFERENCES ${quote(names.sessions)}(agent_id,session_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX ${quote(`${names.sessions}_mem_idx`)} ON ${quote(sessionMemoryTable(names))}(agent_id,session_id,settled);`;
}
