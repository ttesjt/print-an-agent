import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach } from 'vitest';
import { MemoryMeter, MemoryMutations, type MemoryStore } from '@print-an-agent/context-memory';
import type { TokenCounter, TextTokenInput } from '@print-an-agent/model-invocation-core';
import { testCounter } from './counter.js';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
export function borrowed(database = new DatabaseSync(':memory:')) {
  cleanup.push(() => {
    if (database.isOpen) database.close();
  });
  const store = new SqliteMemoryStore({ database });
  return { database, store, ...domain(store) };
}
export function domain(
  store: MemoryStore,
  counter: TokenCounter<TextTokenInput> = testCounter(),
  createItemId?: () => string
) {
  const meter = new MemoryMeter({ counter, maxCacheEntries: 0 });
  return {
    meter,
    mutations: new MemoryMutations({
      store,
      meter,
      defaults: { measurementRef: 'chars' },
      ...(createItemId === undefined ? {} : { createItemId }),
    }),
  };
}
export async function fileStores() {
  const directory = await mkdtemp(join(tmpdir(), 'context-memory-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const first = new SqliteMemoryStore({ path });
  const second = new SqliteMemoryStore({ path });
  cleanup.push(() => {
    first.close();
    second.close();
  });
  return {
    first,
    second,
    path,
    register: (store: SqliteMemoryStore) => cleanup.push(() => store.close()),
  };
}
export function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

export class FaultDatabase extends DatabaseSync {
  failAfterCommit = false;
  closeAfterCommit = false;
  failRollback = false;
  afterCommit: (() => void) | undefined;
  override exec(sql: string): void {
    if (sql === 'ROLLBACK' && this.failRollback) throw new Error('injected rollback failure');
    super.exec(sql);
    if (sql === 'COMMIT') {
      this.afterCommit?.();
      if (this.closeAfterCommit) this.close();
      if (this.failAfterCommit) {
        this.failAfterCommit = false;
        throw new Error('injected lost COMMIT reply');
      }
    }
  }
}
