import type { SqliteSessionTableNamingInput } from './table-names.js';

export interface SqliteSessionAdapterOptions extends SqliteSessionTableNamingInput {
  readonly databasePath: string;
  /** Management readers require an existing schema rather than initializing a new table family. */
  readonly schemaMode?: 'initialize' | 'existing';
  /** Must issue fresh, never-reused IDs, including across adapter reconstruction. */
  readonly createSessionId?: () => string;
  readonly createBranchId?: () => string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}
