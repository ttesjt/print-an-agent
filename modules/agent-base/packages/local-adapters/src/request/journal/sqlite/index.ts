export { SqliteRequestJournalAdapter } from './sqlite-request-journal-adapter.js';

export type { SqliteRequestJournalAdapterOptions } from './types/options.js';

export type {
  SqliteRequestJournalTableNames,
  SqliteRequestJournalTableNamesInput,
  SqliteRequestJournalTableNamingInput,
} from './types/table-names.js';

/** @internal Package coordination API; excluded from public declarations. */
export { SQLITE_REQUEST_JOURNAL_TABLE_KEYS } from './table-keys.js';

export type { SqliteRequestJournalTableName } from './table-keys.js';

export {
  DEFAULT_SQLITE_REQUEST_JOURNAL_TABLE_NAMES,
  resolveSqliteRequestJournalTableNames,
} from './table-names.js';

/** @internal Package coordination API; excluded from public declarations. */
export { assertRequestJournalSchema } from './schema.js';

/** @internal Package coordination API; excluded from public declarations. */
export { purgeSqliteSessionRequests, recoverSqliteSessionRequests } from './journal-maintenance.js';
