import { expect, it } from 'vitest';
import {
  createContextMemoryHistoryBundle,
  createContextMemoryHistoryResources,
  findContextMemoryCommit,
} from '@ta-agent/context-memory';
import { SqliteMemoryStore } from '@ta-agent/context-memory-sqlite';
import { borrowed, domain, fileStores, FaultDatabase } from './support/fixtures.js';

const request = {
  memoryId: 'child',
  requestId: 'fork',
  source: { memoryId: 'parent', revision: 1 },
};
it('preserves a replay receipt even if its read delivers cancellation before the Workflow finishes', async () => {
  const { store, mutations } = borrowed();
  await mutations.create({ memoryId: 'parent', requestId: 'c' });
  const bundle = createContextMemoryHistoryBundle({
    resources: createContextMemoryHistoryResources(store),
  });
  const first = await bundle.workflows.fork.run({ input: request });
  const controller = new AbortController();
  const read = store.getReceipt.bind(store);
  store.getReceipt = async (...args) => {
    const receipt = await read(...args);
    if (args[0] === 'child') controller.abort();
    return receipt;
  };
  const result: unknown = await bundle.workflows.fork
    .run({ input: request, signal: controller.signal })
    .catch((error: unknown) => error);
  if (result instanceof Error)
    expect(findContextMemoryCommit(result)).toMatchObject({
      status: 'committed',
      receipt: { memoryId: 'child', requestId: 'fork' },
    });
  else expect(result).toEqual(first);
  expect((await store.listVersions({ memoryId: 'child' })).versions).toHaveLength(1);
});
it('recovers fork after lost COMMIT delivery without reading the vanished source', async () => {
  const database = new FaultDatabase(':memory:');
  const { store, mutations } = borrowed(database);
  await mutations.create({ memoryId: 'parent', requestId: 'c' });
  const bundle = createContextMemoryHistoryBundle({
    resources: createContextMemoryHistoryResources(store),
  });
  database.failAfterCommit = true;
  const error: unknown = await bundle.workflows.fork
    .run({ input: request })
    .catch((error: unknown) => error);
  expect(findContextMemoryCommit(error)).toMatchObject({
    status: 'committed',
    receipt: { memoryId: 'child', operation: 'fork' },
  });
  database.prepare('DELETE FROM context_memory_documents WHERE memory_id = ?').run('parent');
  database.prepare('DELETE FROM context_memory_history WHERE memory_id = ?').run('parent');
  expect(await bundle.workflows.fork.run({ input: request })).toMatchObject({
    status: 'committed',
    receipt: { revision: 1 },
  });
  expect((await store.listVersions({ memoryId: 'child' })).versions).toHaveLength(1);
});
it('fences all operations after COMMIT-before-publication and rollback both fail; another connection sees no child', async () => {
  const { first, path } = await fileStores();
  await domain(first).mutations.create({ memoryId: 'parent', requestId: 'c' });
  class BrokenDatabase extends FaultDatabase {
    failBeforeCommit = false;
    override exec(sql: string) {
      if (this.failBeforeCommit && sql === 'COMMIT') throw new Error('COMMIT did not execute');
      super.exec(sql);
    }
  }
  const database = new BrokenDatabase(path);
  const { store } = borrowed(database);
  database.failBeforeCommit = true;
  database.failRollback = true;
  await expect(store.fork(request)).rejects.toMatchObject({
    code: 'CLEANUP_FAILED',
    commit: { status: 'unknown' },
  });
  for (const action of [
    () => store.read('child'),
    () => store.getReceipt('child', 'fork'),
    () => store.readVersion({ memoryId: 'child', revision: 1 }),
    () => store.listVersions({ memoryId: 'child' }),
    () => store.fork(request),
  ])
    await expect(action()).rejects.toMatchObject({ code: 'CLEANUP_FAILED' });
  expect(await first.read('child')).toBeUndefined();
  expect(await first.getReceipt('child', 'fork')).toBeUndefined();
  expect(await first.readVersion({ memoryId: 'child', revision: 1 })).toBeUndefined();
  expect(() => store.close()).toThrowError('Memory transaction rollback failed.');
});
it('arbitrates duplicate and competing forks across connections and isolates the source at its old version', async () => {
  const { first, second } = await fileStores();
  const mutations = domain(first).mutations;
  await mutations.create({ memoryId: 'parent', requestId: 'c', items: [{ content: 'old' }] });
  await mutations.apply({
    memoryId: 'parent',
    requestId: 'change',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'future' }],
  });
  const results = await Promise.all([first.fork(request), second.fork(request)]);
  expect(results[0]).toEqual(results[1]);
  expect((await first.read('child'))?.items.map((i) => i.content)).toEqual(['old']);
  expect((await first.listVersions({ memoryId: 'child' })).versions).toHaveLength(1);
  const races = await Promise.allSettled([
    first.fork({ ...request, memoryId: 'race', requestId: 'a' }),
    second.fork({ ...request, memoryId: 'race', requestId: 'b' }),
  ]);
  expect(races.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  expect((await first.listVersions({ memoryId: 'race' })).versions).toHaveLength(1);
});
it('bounds cursor size independently of long identities and rejects ill-formed Unicode IDs', async () => {
  const { store, mutations } = borrowed();
  const memoryId = 'space-'.repeat(2000);
  await mutations.create({ memoryId, requestId: 'c' });
  await mutations.apply({
    memoryId,
    requestId: 'a',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'x' }],
  });
  const first = await store.listVersions({ memoryId, limit: 1 });
  expect(first.nextCursor!.length).toBeLessThan(256);
  expect(
    (await store.listVersions({ memoryId, limit: 1, cursor: first.nextCursor! })).versions[0]
      ?.revision
  ).toBe(1);
  for (const id of ['space-\uD800', 'space-\uD801']) {
    await expect(mutations.create({ memoryId: id, requestId: 'c' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    await expect(store.read(id)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  }
});
it('rejects missing chain links, corrupt current history and unsupported reopened formats', async () => {
  const { store, mutations, database } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'c', items: [{ content: 'a'.repeat(1000) }] });
  for (let revision = 2; revision <= 3; revision++)
    await mutations.apply({
      memoryId: 'm',
      requestId: String(revision),
      expectedRevision: revision - 1,
      commands: [{ op: 'add', content: 'x' }],
    });
  database.prepare('DELETE FROM context_memory_history WHERE revision = 2').run();
  await expect(store.readVersion({ memoryId: 'm', revision: 3 })).rejects.toMatchObject({
    code: 'HISTORY_CORRUPT',
  });
  await expect(
    mutations.apply({
      memoryId: 'm',
      requestId: 'next',
      expectedRevision: 3,
      commands: [{ op: 'add', content: 'no' }],
    })
  ).rejects.toMatchObject({ code: 'HISTORY_CORRUPT', commit: { status: 'not-committed' } });
  expect((await store.read('m'))?.revision).toBe(3);
  database.prepare('UPDATE context_memory_history_meta SET format = 99').run();
  expect(() => new SqliteMemoryStore({ database })).toThrowError(
    'Memory store schema could not be initialized.'
  );
  expect(database.isTransaction).toBe(false);
});
