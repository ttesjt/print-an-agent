import { expect, it, vi } from 'vitest';
import { MemoryMeter, MemoryMutations, type MemoryStore } from '@print-an-agent/context-memory';
import { testCounter } from './support/counter.js';
import { TestMemoryStore } from './support/store.js';

function mutations(store: MemoryStore) {
  return new MemoryMutations({
    store,
    defaults: { measurementRef: 'chars' },
    meter: new MemoryMeter({ counter: testCounter() }),
  });
}
const cases = [
  {
    name: 'create',
    run: (memory: MemoryMutations, signal?: AbortSignal) =>
      memory.create({ memoryId: 'a', requestId: 'create' }, signal),
  },
  {
    name: 'apply',
    run: (memory: MemoryMutations, signal?: AbortSignal) =>
      memory.apply(
        {
          memoryId: 'a',
          requestId: 'apply',
          expectedRevision: 1,
          commands: [{ op: 'add', content: 'new' }],
        },
        signal
      ),
  },
  {
    name: 'configure',
    run: (memory: MemoryMutations, signal?: AbortSignal) =>
      memory.configure(
        {
          memoryId: 'a',
          requestId: 'configure',
          expectedRevision: 1,
          config: { maxContextTokens: 2048 },
        },
        signal
      ),
  },
  {
    name: 'unchanged',
    run: (memory: MemoryMutations, signal?: AbortSignal) =>
      memory.apply(
        { memoryId: 'a', requestId: 'unchanged', expectedRevision: 1, commands: [] },
        signal
      ),
  },
];

it.each(cases)('preserves $name receipt obtained before a late abort', async ({ name, run }) => {
  const actual = new TestMemoryStore();
  const original = mutations(actual);
  if (name !== 'create') await original.create({ memoryId: 'a', requestId: 'create' });
  const result = await run(original);
  const controller = new AbortController();
  const read = vi.fn(actual.read.bind(actual));
  const commit = vi.fn(actual.commit.bind(actual));
  const delayed: MemoryStore = {
    read,
    commit,
    getReceipt: async (memoryId, requestId, signal) => {
      const receipt = await actual.getReceipt(memoryId, requestId, signal);
      controller.abort();
      return receipt;
    },
  };
  expect(await run(mutations(delayed), controller.signal)).toEqual(result);
  expect(controller.signal.aborted).toBe(true);
  expect(read).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('still observes late cancellation if the receipt lookup found no committed result', async () => {
  const actual = new TestMemoryStore();
  const controller = new AbortController();
  const delayed: MemoryStore = {
    read: actual.read.bind(actual),
    commit: actual.commit.bind(actual),
    getReceipt: async (memoryId, requestId, signal) => {
      const receipt = await actual.getReceipt(memoryId, requestId, signal);
      controller.abort();
      return receipt;
    },
  };
  await expect(
    mutations(delayed).create({ memoryId: 'a', requestId: 'create' }, controller.signal)
  ).rejects.toMatchObject({ code: 'OPERATION_ABORTED', commit: { status: 'not-committed' } });
  expect(actual.commits).toBe(0);
});

it('does not treat an unmatched valid receipt as this request succeeding when aborted', async () => {
  const actual = new TestMemoryStore();
  await mutations(actual).create({ memoryId: 'a', requestId: 'create' });
  const controller = new AbortController();
  const delayed: MemoryStore = {
    read: actual.read.bind(actual),
    commit: actual.commit.bind(actual),
    getReceipt: async (memoryId, requestId, signal) => {
      const receipt = await actual.getReceipt(memoryId, requestId, signal);
      controller.abort();
      return receipt;
    },
  };
  await expect(
    mutations(delayed).create(
      { memoryId: 'a', requestId: 'create', items: [{ content: 'different' }] },
      controller.signal
    )
  ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT', commit: { status: 'not-committed' } });
  expect(actual.commits).toBe(1);
});
