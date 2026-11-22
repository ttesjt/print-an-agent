import { expect, it } from 'vitest';
import { ContextMemoryError, MemoryMeter, MemoryMutations } from '@print-an-agent/context-memory';
import type { MemoryStore } from '@print-an-agent/context-memory';
import { TestMemoryStore, gate } from '../../support/store.js';
import { testCounter } from '../../support/counter.js';

const meter = () => new MemoryMeter({ counter: testCounter() });

it('does not call an invalid returned receipt a known uncommitted rejection', async () => {
  const actual = new TestMemoryStore();
  const faulty: MemoryStore = {
    read: actual.read.bind(actual),
    getReceipt: actual.getReceipt.bind(actual),
    commit: async (change, signal) => ({
      ...(await actual.commit(change, signal)),
      inputDigest: 'wrong digest',
    }),
  };
  const mutations = new MemoryMutations({
    store: faulty,
    meter: meter(),
    defaults: { measurementRef: 'chars' },
  });
  await expect(mutations.create({ memoryId: 'a', requestId: 'create' })).rejects.toMatchObject({
    code: 'COMMIT_STATUS_UNKNOWN',
    commit: { status: 'unknown' },
  });
  expect((await actual.read('a'))?.revision).toBe(1);
});

it('preserves committed cleanup failure even if cancellation also arrives', async () => {
  const store = new TestMemoryStore();
  const controller = new AbortController();
  const mutations = new MemoryMutations({
    store,
    meter: meter(),
    defaults: { measurementRef: 'chars' },
  });
  store.afterCommit = () => {
    const receipt = [...store.receipts.values()][0];
    if (receipt === undefined) throw new Error('missing receipt');
    controller.abort();
    throw new ContextMemoryError('CLEANUP_FAILED', 'Committed but cleanup failed.', {
      commit: { status: 'committed', receipt },
    });
  };
  await expect(
    mutations.create({ memoryId: 'a', requestId: 'create' }, controller.signal)
  ).rejects.toMatchObject({
    code: 'CLEANUP_FAILED',
    commit: { status: 'committed', receipt: { revision: 1 } },
  });
});

it('observes cancellation before the mutation after waiting for token counting', async () => {
  const store = new TestMemoryStore();
  const entered = gate();
  const release = gate();
  const controller = new AbortController();
  const counting = new MemoryMeter({
    counter: testCounter('chars', async (text) => {
      entered.release();
      await release.promise;
      return text.length;
    }),
  });
  const mutations = new MemoryMutations({
    store,
    meter: counting,
    defaults: { measurementRef: 'chars' },
  });
  const operation = mutations.create(
    { memoryId: 'a', requestId: 'create', items: [{ content: 'pending' }] },
    controller.signal
  );
  await entered.promise;
  controller.abort();
  release.release();
  await expect(operation).rejects.toMatchObject({
    code: 'OPERATION_ABORTED',
    commit: { status: 'not-committed' },
  });
  expect(store.commits).toBe(0);
});

it('applies optional item rules at the real boundary and allows disabled budgets', async () => {
  const store = new TestMemoryStore();
  const mutations = new MemoryMutations({
    store,
    meter: meter(),
    defaults: { measurementRef: 'chars', maxContextTokens: null },
    validateItem: (item) => {
      if (item.content.includes('reject')) throw new Error('host policy');
    },
  });
  await expect(
    mutations.create({ memoryId: 'a', requestId: 'invalid', items: [{ content: 'reject' }] })
  ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  expect(store.commits).toBe(0);
  await mutations.create({
    memoryId: 'a',
    requestId: 'valid',
    items: [{ content: 'x'.repeat(5000) }],
  });
  expect((await store.read('a'))?.measurement.tokens).toBe(5000);
});
