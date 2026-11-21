import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteAgentConfigTableNames } from '../types/table-names.js';

export function createConfigStoreMigration(tableNames: SqliteAgentConfigTableNames): string {
  return `
  CREATE TABLE ${quoteSqliteIdentifier(tableNames.configs)} (
    agent_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    value_json TEXT NOT NULL
  ) STRICT;
`;
}
