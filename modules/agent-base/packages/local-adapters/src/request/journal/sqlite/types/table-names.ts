import type { SqliteRequestJournalTableName } from '../table-keys.js';

export type SqliteRequestJournalTableNamesInput = Readonly<
  Partial<Record<SqliteRequestJournalTableName, string>>
>;

export interface SqliteRequestJournalTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: SqliteRequestJournalTableNamesInput;
}

export interface SqliteRequestJournalTableNames {
  readonly schema: string;
  readonly entries: string;
}
