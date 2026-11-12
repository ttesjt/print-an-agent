import { setImmediate } from 'node:timers/promises';
import { expect, it } from 'vitest';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { consumer } from './support/model.js';
import { memoryPath, ownedStore, gate, borrowDatabase } from './support/storage.js';

it('lets a host cancel, drain all borrowed work, then close its owned connection', async () => {
  const path = await memoryPath();
  const store = ownedStore(path);
  const entered = gate();
  const release = gate();
  const client = consumer(store, async (request) => {
    if (request.instruction === 'hold') {
      entered.release();
      await release.promise;
    }
    return [{ op: 'add', content: 'new' }];
  });
  for (const memoryId of ['a', 'b'])
    await client.bundle.workflows.create.run({ input: { memoryId, requestId: 'create' } });
  const controller = new AbortController();
  const pending = client.bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'hold' },
    signal: controller.signal,
  });
  let shutdown: Promise<unknown> | undefined;
  try {
    await entered.promise;
    await client.bundle.workflows.edit.run({
      input: { memoryId: 'b', requestId: 'edit', instruction: 'other' },
    });
    controller.abort();
    let closed = false;
    shutdown = Promise.allSettled([pending]).then((results) => {
      store.close();
      closed = true;
      return results;
    });
    await setImmediate();
    expect(closed).toBe(false);
    expect(client.actor.active).toBe(1);
    expect((await store.read('a'))?.revision).toBe(1);
    release.release();
    expect(await shutdown).toMatchObject([
      { status: 'rejected', reason: { code: 'OPERATION_ABORTED' } },
    ]);
    expect(client.actor.active).toBe(0);
    expect(closed).toBe(true);
    const reopened = ownedStore(path);
    expect(await reopened.getReceipt('a', 'edit')).toBeUndefined();
    expect((await reopened.read('b'))?.revision).toBe(2);
  } finally {
    release.release();
    await Promise.allSettled([pending, ...(shutdown === undefined ? [] : [shutdown])]);
  }
});

it('does not close a borrowed connection when a planner fails or the adapter closes', async () => {
  const database = borrowDatabase();
  const store = new SqliteMemoryStore({ database });
  const client = consumer(store, () => {
    throw new Error('Provider failure.');
  });
  await client.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await expect(
    client.bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
    })
  ).rejects.toMatchObject({ code: 'MODEL_INVOCATION_FAILED' });
  expect(client.actor.active).toBe(0);
  expect((await store.read('a'))?.revision).toBe(1);
  store.close();
  expect(database.isOpen).toBe(true);
  expect(database.isTransaction).toBe(false);
});

it('rejects initialization inside a caller transaction without closing or rolling it back', () => {
  const database = borrowDatabase();
  database.exec('BEGIN');
  expect(() => new SqliteMemoryStore({ database })).toThrow('schema could not be initialized');
  expect(database.isOpen).toBe(true);
  expect(database.isTransaction).toBe(true);
  database.exec('ROLLBACK');
});
