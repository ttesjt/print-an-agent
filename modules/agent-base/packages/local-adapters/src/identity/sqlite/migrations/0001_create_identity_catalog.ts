import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteAgentIdentityTableNames } from '../types/table-names.js';

export function createIdentityCatalogMigration(tableNames: SqliteAgentIdentityTableNames): string {
  return `
  CREATE TABLE ${quoteSqliteIdentifier(tableNames.identities)} (
    agent_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
  ) STRICT;
`;
}
