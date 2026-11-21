import type { SqliteSessionTableNames } from '../table-names.js';
import { quoteSqliteIdentifier } from '../table-names.js';

export function addSessionMetadataMigration(tableNames: SqliteSessionTableNames): string {
  return `
  ALTER TABLE ${quoteSqliteIdentifier(tableNames.sessions)}
    ADD COLUMN title TEXT;

  ALTER TABLE ${quoteSqliteIdentifier(tableNames.sessions)}
    ADD COLUMN metadata_revision INTEGER NOT NULL DEFAULT 0 CHECK (metadata_revision >= 0);

  ALTER TABLE ${quoteSqliteIdentifier(tableNames.sessions)}
    ADD COLUMN metadata_updated_at INTEGER NOT NULL DEFAULT 0 CHECK (metadata_updated_at >= 0);

  UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
  SET metadata_updated_at = created_at;
`;
}
