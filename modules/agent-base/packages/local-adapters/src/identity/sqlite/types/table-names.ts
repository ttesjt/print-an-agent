import type { SqliteAgentIdentityTableName } from '../table-keys.js';

export type SqliteAgentIdentityTableNamesInput = Readonly<
  Partial<Record<SqliteAgentIdentityTableName, string>>
>;

export interface SqliteAgentIdentityTableNamingInput {
  readonly tablePrefix?: string;
  readonly tableNames?: SqliteAgentIdentityTableNamesInput;
}

export interface SqliteAgentIdentityTableNames {
  readonly schema: string;
  readonly identities: string;
}
