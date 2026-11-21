export { MemoryRequestJournalAdapter } from './memory/index.js';

/** @internal Package coordination API; excluded from public declarations. */
export { memoryJournalCoordination } from './memory/index.js';

export {
  DEFAULT_SQLITE_REQUEST_JOURNAL_TABLE_NAMES,
  SqliteRequestJournalAdapter,
  resolveSqliteRequestJournalTableNames,
} from './sqlite/index.js';

/** @internal Package coordination API; excluded from public declarations. */
export {
  SQLITE_REQUEST_JOURNAL_TABLE_KEYS,
  assertRequestJournalSchema,
  purgeSqliteSessionRequests,
  recoverSqliteSessionRequests,
} from './sqlite/index.js';

export type {
  SqliteRequestJournalAdapterOptions,
  SqliteRequestJournalTableName,
  SqliteRequestJournalTableNames,
  SqliteRequestJournalTableNamesInput,
  SqliteRequestJournalTableNamingInput,
} from './sqlite/index.js';
