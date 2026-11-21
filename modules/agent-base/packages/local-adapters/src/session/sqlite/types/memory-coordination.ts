import type { DatabaseSync } from 'node:sqlite';
import type { SqliteSessionTableNames } from './table-names.js';

export interface SqliteSessionMemoryContext {
  readonly tableNames: SqliteSessionTableNames;
  readonly clock: () => number;
  readonly createBranchId: () => string;
  useDatabase<T>(this: void, operation: string, action: (database: DatabaseSync) => T): T;
}
