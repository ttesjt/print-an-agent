import { expect, it } from 'vitest';
import {
  applyItemCommands,
  ContextMemoryError,
  MemoryMeter,
  MemoryMutations,
  parseMemorySnapshot,
  readMemoryContext,
} from '@print-an-agent/context-memory';
import { TestMemoryStore, gate } from './support/store.js';
import { errorCode } from './support/errors.js';
import { testCounter } from './support/counter.js';

function fixture() {
  const store = new TestMemoryStore();
  const meter = new MemoryMeter({ counter: testCounter('characters') });
  let next = 0;
  const mutations = new MemoryMutations({
    store,
    meter,
    defaults: { measurementRef: 'characters' },
    createItemId: () => `item-${++next}`,
  });
  return { store, meter, mutations };
}

it('normalizes empty commands atomically, preserves order, and replaces whole metadata', () => {
  let allocations = 0;
  const original = [
    { id: 'a', content: 'original', metadata: { a: 1 } },
    { id: 'b', content: 'keep' },
  ];
  const result = applyItemCommands(
    original,
    [
      { op: 'add', content: '\n ' },
      { op: 'replace', itemId: 'a', content: '\t' },
      { op: 'replace', itemId: 'b', content: ' keep\n' },
      { op: 'add', content: 'new' },
    ],
    () => {
      allocations++;
      return 'c';
    }
  );
  expect(result.items).toEqual([
    { id: 'b', content: ' keep\n' },
    { id: 'c', content: 'new' },
  ]);
  expect(result.commandOutcomes.map((entry) => entry.outcome)).toEqual([
    'ignored',
    'removed',
    'updated',
    'added',
  ]);
  expect(allocations).toBe(1);
  expect(original[0]?.content).toBe('original');
  expect(
    applyItemCommands(original, [{ op: 'replace', itemId: 'a', content: 'original' }]).items[0]
  ).toEqual({ id: 'a', content: 'original' });
  expect(
    errorCode(() =>
      applyItemCommands(
        original,
        [
          { op: 'add', content: 'x' },
          { op: 'replace', itemId: 'missing', content: '' },
        ],
        () => {
          allocations++;
          return 'd';
        }
      )
    )
  ).toBe('ITEM_NOT_FOUND');
  expect(allocations).toBe(1);
  expect(
    errorCode(() => applyItemCommands(original, [{ op: 'add', content: 'x' }], () => 'a'))
  ).toBe('INPUT_INVALID');
});

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

it('recounts alternate tokenizers, returns full report, and rejects unrecognized render overrides', async () => {
  const { store, mutations } = fixture();
  await mutations.create({
    memoryId: 'a',
    requestId: 'create',
    items: [{ content: 'hello' }],
    config: { maxContextTokens: 10 },
  });
  const meter = new MemoryMeter({
    counter: testCounter('other', (text) => Promise.resolve(text.length * 10)),
  });
  await expect(
    readMemoryContext({ store, meter }, { memoryId: 'a', measurementRef: 'other' })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  const report = await readMemoryContext(
    { store, meter },
    { memoryId: 'a', measurementRef: 'other', budgetPolicy: 'report' }
  );
  expect(report.text).toBe('hello');
  expect(report.budget.status).toBe('exceeded');
  expect(report.snapshot.revision).toBe(1);
  expect(report.measurement.measurementRef).toBe('other');
  const invalid = { memoryId: 'a', render: { format: 'json' } };
  await expect(readMemoryContext({ store, meter }, invalid)).rejects.toBeInstanceOf(
    ContextMemoryError
  );
  expect((await store.read('a'))?.config.measurementRef).toBe('characters');
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

it('reports ambiguous persistence failures and recovers through the original request receipt', async () => {
  const { store, mutations } = fixture();
  store.afterCommit = () => {
    throw new Error('reply lost');
  };
  const input = { memoryId: 'a', requestId: 'create', items: [{ content: 'x' }] };
  await expect(mutations.create(input)).rejects.toMatchObject({
    code: 'COMMIT_STATUS_UNKNOWN',
    commit: { status: 'unknown', requestId: 'create' },
  });
  delete store.afterCommit;
  expect(await mutations.create(input)).toMatchObject({
    status: 'committed',
    receipt: { revision: 1 },
  });
  expect(store.commits).toBe(1);
  const snapshot = await store.read('a');
  expect(parseMemorySnapshot(snapshot).items[0]?.content).toBe('x');
});
