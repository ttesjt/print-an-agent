import { expect, it } from 'vitest';
import { parseMemorySnapshot } from '@print-an-agent/context-memory';
import { createMemoryFixture as fixture } from '../../support/memory.js';

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
