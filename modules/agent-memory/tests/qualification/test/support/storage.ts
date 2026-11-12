import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { afterEach } from 'vitest';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.splice(0).reverse()) {
    try {
      await close();
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Consumer cleanup failed.');
});
export function ownedStore(path: string) {
  const store = new SqliteMemoryStore({ path });
  cleanup.push(() => store.close());
  return store;
}
export async function memoryPath() {
  const directory = await mkdtemp(join(tmpdir(), 'memory-public-consumer-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'memory.sqlite');
}
export function borrowDatabase(database = new DatabaseSync(':memory:')) {
  cleanup.push(() => {
    if (database.isOpen) database.close();
  });
  return database;
}
export function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
