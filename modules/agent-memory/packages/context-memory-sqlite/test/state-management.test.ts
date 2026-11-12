import { expect, it } from 'vitest';
import {
  createContextMemoryStateBundle,
  createContextMemoryStateResources,
} from '@print-an-agent/context-memory';
import { borrowed } from './support/fixtures.js';

it('inspects the exact persisted snapshot and replays complete inputs without measurement resources', async () => {
  const { store, mutations } = borrowed();
  const input = { memoryId: 'notes', requestId: 'create', items: [{ content: 'keep exact\n' }] };
  const result = await mutations.create(input);
  if (result.status === 'skipped') throw new Error('Unexpected skip');
  const resources = createContextMemoryStateResources(store);
  const bundle = createContextMemoryStateBundle({ resources });
  expect(await bundle.workflows.inspect.run({ input: { memoryId: 'notes' } })).toEqual(
    await store.read('notes')
  );
  expect(await resources.memory.replay({ operation: 'create', input })).toEqual(result.receipt);
  await expect(
    resources.memory.replay({ operation: 'create', input: { ...input, items: [] } })
  ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  await expect(
    bundle.workflows.inspect.run({ input: { memoryId: 'missing' } })
  ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
});

it('preserves the matched receipt when cancellation arrives with its read', async () => {
  const { store, mutations } = borrowed();
  const input = { memoryId: 'notes', requestId: 'create' };
  const result = await mutations.create(input);
  const abort = new AbortController();
  const getReceipt = store.getReceipt.bind(store);
  store.getReceipt = async (...args) => {
    const receipt = await getReceipt(...args);
    abort.abort();
    return receipt;
  };
  expect(
    await createContextMemoryStateResources(store).memory.replay(
      { operation: 'create', input },
      abort.signal
    )
  ).toEqual(result.status === 'skipped' ? undefined : result.receipt);
});
