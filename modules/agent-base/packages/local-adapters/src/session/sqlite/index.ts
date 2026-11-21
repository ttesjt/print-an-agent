export { SqliteSessionAdapter } from './sqlite-session-adapter.js';

export type { SqliteSessionAdapterOptions } from './types/options.js';

export type {
  SqliteSessionTableNames,
  SqliteSessionTableNamesInput,
  SqliteSessionTableNamingInput,
} from './types/table-names.js';

/** @internal Package coordination API; excluded from public declarations. */
export { SQLITE_SESSION_TABLE_KEYS } from './table-keys.js';

export type { SqliteSessionTableName } from './table-keys.js';

export {
  DEFAULT_SQLITE_SESSION_TABLE_NAMES,
  resolveSqliteSessionTableNames,
} from './table-names.js';

/** @internal Package coordination API; excluded from public declarations. */
export {
  defineSqliteDatabaseConfiguration,
  runImmediateTransaction,
  useSqliteDatabase,
} from './database.js';

/** @internal Package coordination API; excluded from public declarations. */
export { assertSessionSchema } from './schema/validation.js';

/** @internal Package coordination API; excluded from public declarations. */
export { assertSqliteSessionWrite } from './lifecycle/execution.js';

/** @internal Package coordination API; excluded from public declarations. */
export { purgeSqliteSession, recoverSqliteSession } from './lifecycle/maintenance.js';

/** @internal Package coordination API; excluded from public declarations. */
export { readSqliteLifecycle } from './lifecycle/state.js';
