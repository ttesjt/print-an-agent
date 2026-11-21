export { MemorySessionAdapter } from './memory/memory-session-adapter.js';

export type { MemorySessionAdapterOptions } from './memory/memory-session-adapter.js';

/** @internal Package coordination API; not part of public declarations. */
export { memorySessionCoordination } from './memory/coordination.js';

export { SqliteSessionAdapter } from './sqlite/sqlite-session-adapter.js';

export type { SqliteSessionAdapterOptions } from './sqlite/sqlite-session-adapter.js';

/** @internal Package coordination API; not part of public declarations. */
export {
  defineSqliteDatabaseConfiguration,
  runImmediateTransaction,
  useSqliteDatabase,
} from './sqlite/database.js';

export {
  DEFAULT_SQLITE_SESSION_TABLE_NAMES,
  resolveSqliteSessionTableNames,
} from './sqlite/table-names.js';

export type {
  SqliteSessionTableName,
  SqliteSessionTableNames,
  SqliteSessionTableNamesInput,
  SqliteSessionTableNamingInput,
} from './sqlite/table-names.js';

/** @internal Package coordination API; not part of public declarations. */
export { assertSessionSchema } from './sqlite/schema.js';

/** @internal Package coordination API; not part of public declarations. */
export {
  assertSqliteSessionWrite,
  purgeSqliteSession,
  readSqliteLifecycle,
  recoverSqliteSession,
} from './sqlite/session-lifecycle-storage.js';
