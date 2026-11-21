import type { SqliteSessionTableNamingInput } from '../../../../session/index.js';
import type { SqliteRequestJournalTableNamingInput } from './table-names.js';

export interface SqliteRequestJournalAdapterOptions extends SqliteRequestJournalTableNamingInput {
  readonly databasePath: string;
  /** Management readers require an existing schema rather than initializing a new table family. */
  readonly schemaMode?: 'initialize' | 'existing';
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  /** Same-database execution fence; normally selected by the coordinated persistence factory. */
  readonly sessionExecution?: SqliteSessionTableNamingInput;
}
