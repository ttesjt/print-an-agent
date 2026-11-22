import { expect, it } from 'vitest';
import { readMemoryContext } from '@print-an-agent/context-memory';
import { gate } from '../../support/store.js';
import { createMemoryFixture as fixture } from '../../support/memory.js';

it('creates empty/initial state, commits edits, replays identities, and keeps unchanged revisions', async () => {
  const { store, meter, mutations } = fixture();
  const input = {
    memoryId: 'a',
    requestId: 'create',
    items: [{ content: ' hi\n' }, { content: ' ' }],
  };
  const created = await mutations.create(input);
  expect(created).toMatchObject({
    status: 'committed',
    receipt: { revision: 1, changes: { addedItemIds: ['item-1'] } },
  });
  expect(await mutations.create(input)).toEqual(created);
  await expect(mutations.create({ ...input, items: [] })).rejects.toMatchObject({
    code: 'REQUEST_CONFLICT',
  });
  await expect(mutations.create({ memoryId: 'a', requestId: 'other' })).rejects.toMatchObject({
    code: 'MEMORY_ALREADY_EXISTS',
  });
  expect(
    await mutations.apply({ memoryId: 'a', requestId: 'same', expectedRevision: 1, commands: [] })
  ).toMatchObject({ status: 'unchanged', receipt: { revision: 1 } });
  await mutations.apply({
    memoryId: 'a',
    requestId: 'edit',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'next' }],
  });
  const read = await readMemoryContext({ store, meter }, { memoryId: 'a' });
  expect(read.text).toBe(' hi\n\nnext');
  expect(read.snapshot.revision).toBe(2);
  await mutations.create({ memoryId: 'empty', requestId: 'create', items: [{ content: '\n' }] });
  expect((await readMemoryContext({ store, meter }, { memoryId: 'empty' })).text).toBe('');
  await expect(
    mutations.apply({ memoryId: 'a', requestId: 'stale', expectedRevision: 1, commands: [] })
  ).rejects.toMatchObject({ code: 'REVISION_CONFLICT', commit: { status: 'not-committed' } });
});

it('configures separator by CAS and rejects oversized configuration without changing state', async () => {
  const { store, mutations } = fixture();
  await mutations.create({
    memoryId: 'a',
    requestId: 'create',
    items: [{ content: 'a' }, { content: 'b' }],
    config: { maxContextTokens: 5 },
  });
  await expect(
    mutations.configure({
      memoryId: 'a',
      requestId: 'too-big',
      expectedRevision: 1,
      config: { render: { format: 'text', separator: '.....' } },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect((await store.read('a'))?.revision).toBe(1);
  await mutations.configure({
    memoryId: 'a',
    requestId: 'gap',
    expectedRevision: 1,
    config: { render: { format: 'text', separator: '\n\n' } },
  });
  expect((await store.read('a'))?.revision).toBe(2);
});

it('cancels after slow reads before committing and preserves successful results after commit', async () => {
  const { store, mutations } = fixture();
  await mutations.create({ memoryId: 'a', requestId: 'create' });
  const pending = gate();
  const started = gate();
  const controller = new AbortController();
  store.beforeRead = () => {
    started.release();
    return pending.promise;
  };
  const operation = mutations.apply(
    {
      memoryId: 'a',
      requestId: 'abort',
      expectedRevision: 1,
      commands: [{ op: 'add', content: 'x' }],
    },
    controller.signal
  );
  await started.promise;
  controller.abort();
  pending.release();
  await expect(operation).rejects.toMatchObject({
    code: 'OPERATION_ABORTED',
    commit: { status: 'not-committed' },
  });
  expect(store.commits).toBe(1);
  delete store.beforeRead;
  const after = new AbortController();
  store.afterCommit = () => after.abort();
  expect(
    await mutations.apply(
      {
        memoryId: 'a',
        requestId: 'done',
        expectedRevision: 1,
        commands: [{ op: 'add', content: 'ok' }],
      },
      after.signal
    )
  ).toMatchObject({ status: 'committed', receipt: { revision: 2 } });
});
