import type { SQLOutputValue } from 'node:sqlite';
import type { SqliteManagedNamespaceTableNames } from '../../types/namespace-tables.js';

export type SqliteRow = Record<string, SQLOutputValue>;

export interface SharedSqliteConfiguration {
  readonly databasePath: string;
  readonly busyTimeoutMilliseconds: number;
  readonly tableNames: SqliteManagedNamespaceTableNames;
}
