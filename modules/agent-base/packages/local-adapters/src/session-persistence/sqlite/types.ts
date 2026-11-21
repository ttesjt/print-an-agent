import type { SqliteRequestJournalTableNamingInput } from '../../request/index.js';
import type { SqliteSessionTableNamingInput } from '../../session/index.js';

export interface SqliteSessionPersistenceOptions {
  readonly databasePath: string;
  /** Require the selected Session and Journal schemas to exist without creating them. */
  readonly schemaMode?: 'initialize' | 'existing';
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
  readonly session?: SqliteSessionTableNamingInput;
  readonly requestJournal?: SqliteRequestJournalTableNamingInput;
}
