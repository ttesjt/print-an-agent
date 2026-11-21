import type { SqliteSessionTableName } from '../table-keys.js';

export type SqliteSessionTableNamesInput = Readonly<
  Partial<Record<SqliteSessionTableName, string>>
>;

export interface SqliteSessionTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: SqliteSessionTableNamesInput;
}

export interface SqliteSessionTableNames {
  readonly schema: string;
  readonly sessions: string;
  readonly turns: string;
  readonly branches: string;
  readonly compactions: string;
}
