import { expect, it } from 'vitest';
import { readMemoryContext } from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { borrowed, domain, fileStores } from './support/fixtures.js';

it('persists full snapshots and request receipts across connections and reopen', async () => {
  const { first, second, path, register } = await fileStores();
  const { mutations } = domain(first, undefined, () => 'system-id');
  const input = {
    memoryId: 'project/a',
    requestId: 'create',
    items: [{ content: 'remember "quotes"\n' }],
  };
  const receipt = await mutations.create(input);
  expect((await second.read('project/a'))?.items[0]?.id).toBe('system-id');
  first.close();
  second.close();
  const reopened = new SqliteMemoryStore({ path });
  register(reopened);
  expect(await domain(reopened, undefined, () => 'different-id').mutations.create(input)).toEqual(
    receipt
  );
  expect((await reopened.read('project/a'))?.revision).toBe(1);
  expect(await reopened.getReceipt('project/a', 'create')).toMatchObject({ revision: 1 });
});
it('stores unchanged receipts without increasing revision and reserves request IDs by memory scope', async () => {
  const { store, mutations, meter } = borrowed();
  await mutations.create({ memoryId: 'a', requestId: 'same' });
  await mutations.create({ memoryId: 'b', requestId: 'same' });
  const input = { memoryId: 'a', requestId: 'empty', expectedRevision: 1, commands: [] };
  expect(await mutations.apply(input)).toMatchObject({
    status: 'unchanged',
    receipt: { revision: 1 },
  });
  await mutations.apply({
    memoryId: 'a',
    requestId: 'add',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'x' }],
  });
  expect(await mutations.apply(input)).toMatchObject({
    status: 'unchanged',
    receipt: { revision: 1 },
  });
  await expect(
    mutations.apply({ ...input, commands: [{ op: 'add', content: 'different' }] })
  ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  expect((await store.read('a'))?.revision).toBe(2);
  expect((await store.read('b'))?.revision).toBe(1);
  expect((await readMemoryContext({ store, meter }, { memoryId: 'a' })).text).toBe('x');
});
it('never treats corrupt snapshots or receipts as a missing/empty document', async () => {
  const { database, store, mutations } = borrowed();
  await mutations.create({ memoryId: 'a', requestId: 'create' });
  database
    .prepare('UPDATE context_memory_documents SET snapshot_json = ? WHERE memory_id = ?')
    .run('{bad', 'a');
  await expect(store.read('a')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  database.prepare('UPDATE context_memory_receipts SET receipt_json = ?').run('{bad');
  await expect(store.getReceipt('a', 'create')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  expect(await store.read('missing')).toBeUndefined();
});
it('closes owned connections idempotently and leaves borrowed connections usable', async () => {
  const owned = new SqliteMemoryStore({ path: ':memory:' });
  owned.close();
  owned.close();
  await expect(owned.read('a')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  const { database, store } = borrowed();
  store.close();
  store.close();
  expect(database.isOpen).toBe(true);
  expect(database.prepare('SELECT 1 AS value').get()?.value).toBe(1);
  await expect(store.getReceipt('a', 'x')).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
});

it('classifies corruption discovered at transactional CAS as storage failure, not bad input', async () => {
  const { database, store, mutations } = borrowed();
  await mutations.create({ memoryId: 'a', requestId: 'create' });
  const snapshot = await store.read('a');
  if (snapshot === undefined) throw new Error('Missing snapshot.');
  const { config, items, measurement } = snapshot;
  database.prepare('UPDATE context_memory_documents SET snapshot_json = ?').run('{bad');
  await expect(
    store.commit({
      request: { memoryId: 'a', requestId: 'cas', operation: 'apply', input: {} },
      expectedRevision: 1,
      state: { config, items, measurement },
      commandOutcomes: [],
    })
  ).rejects.toMatchObject({ code: 'STORAGE_FAILED', commit: { status: 'not-committed' } });
  expect(database.isTransaction).toBe(false);
  expect(await store.getReceipt('a', 'cas')).toBeUndefined();
});
