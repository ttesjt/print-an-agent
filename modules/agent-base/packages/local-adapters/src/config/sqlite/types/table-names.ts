import type { SqliteAgentConfigTableName } from '../table-keys.js';

export type SqliteAgentConfigTableNamesInput = Readonly<
  Partial<Record<SqliteAgentConfigTableName, string>>
>;

export interface SqliteAgentConfigTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: SqliteAgentConfigTableNamesInput;
}

export interface SqliteAgentConfigTableNames {
  readonly schema: string;
  readonly configs: string;
}
