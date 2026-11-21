import {
  createMemorySessionPersistence,
  createSqliteSessionPersistence,
  type SqliteSessionPersistenceOptions,
} from '@print-an-agent/base-local-adapters';
/** Inference from compiled public entries must emit portable types. */
export function memoryPersistence() {
  return createMemorySessionPersistence();
}
export function sqlitePersistence(options: SqliteSessionPersistenceOptions) {
  return createSqliteSessionPersistence(options);
}
