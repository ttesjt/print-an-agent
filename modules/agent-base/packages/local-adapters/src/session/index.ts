export { MemorySessionAdapter } from './memory/index.js';

/** @internal Package coordination API; excluded from public declarations. */
export { memorySessionCoordination } from './memory/index.js';

export type { MemorySessionAdapterOptions } from './memory/index.js';

export {
  DEFAULT_SQLITE_SESSION_TABLE_NAMES,
  SqliteSessionAdapter,
  resolveSqliteSessionTableNames,
} from './sqlite/index.js';

/** @internal Package coordination API; excluded from public declarations. */
export {
  SQLITE_SESSION_TABLE_KEYS,
  assertSessionSchema,
  assertSqliteSessionWrite,
  defineSqliteDatabaseConfiguration,
  purgeSqliteSession,
  readSqliteLifecycle,
  recoverSqliteSession,
  runImmediateTransaction,
  useSqliteDatabase,
} from './sqlite/index.js';

export type {
  SqliteSessionAdapterOptions,
  SqliteSessionTableName,
  SqliteSessionTableNames,
  SqliteSessionTableNamesInput,
  SqliteSessionTableNamingInput,
} from './sqlite/index.js';

export type { LocalLifecycleSessionPort } from './types/ports.js';
