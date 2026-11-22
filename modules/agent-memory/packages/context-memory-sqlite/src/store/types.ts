import type { SqliteConnectionOptions, MemoryHistoryStorageOptions } from '../database/index.js';

export type SqliteMemoryStoreOptions = SqliteConnectionOptions & {
  readonly history?: MemoryHistoryStorageOptions;
};
