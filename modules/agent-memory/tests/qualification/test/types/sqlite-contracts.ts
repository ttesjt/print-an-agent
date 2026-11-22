import { DatabaseSync } from 'node:sqlite';
import type { MemoryHistoryStore } from '@print-an-agent/context-memory';
import {
  SqliteMemoryStore,
  type SqliteMemoryStoreOptions,
  type MemoryHistoryStorageOptions,
} from '@print-an-agent/context-memory-sqlite';

// Inferred exports exercise portable class and option declarations from an independent package.
export function ownedStore(path: string) {
  return new SqliteMemoryStore({ path, busyTimeoutMs: 0, history: { maxDeltaChain: 1 } });
}
export function borrowedStore(database: DatabaseSync) {
  return new SqliteMemoryStore({ database });
}
export function configuredStore(options: ConstructorParameters<typeof SqliteMemoryStore>[0]) {
  return new SqliteMemoryStore(options);
}
export function historyCapability(store: SqliteMemoryStore): MemoryHistoryStore {
  return store;
}
export function optionContracts(
  options: SqliteMemoryStoreOptions,
  history: MemoryHistoryStorageOptions,
  database: DatabaseSync
): void {
  // @ts-expect-error Store options preserve their readonly public slots.
  options.history = {};
  // @ts-expect-error History storage options remain readonly.
  history.maxDeltaChain = 2;
  // @ts-expect-error A connection is either owned by path or borrowed explicitly.
  new SqliteMemoryStore({ path: ':memory:', database });
  // @ts-expect-error Busy timeout cannot reconfigure a borrowed connection.
  new SqliteMemoryStore({ database, busyTimeoutMs: 0 });
  // @ts-expect-error A store requires an explicit connection source.
  new SqliteMemoryStore({});
  // @ts-expect-error Explicit undefined is not an omitted optional history setting.
  new SqliteMemoryStore({ path: ':memory:', history: undefined });
  // @ts-expect-error Explicit undefined is not an omitted chain limit.
  new SqliteMemoryStore({ database, history: { maxDeltaChain: undefined } });
}
