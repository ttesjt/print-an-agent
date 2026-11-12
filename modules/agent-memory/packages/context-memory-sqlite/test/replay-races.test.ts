import { expect, it } from 'vitest';
import type { MemoryMutations, MemoryStore } from '@print-an-agent/context-memory';
import { domain, fileStores, gate } from './support/fixtures.js';

const kinds = ['apply', 'configure'] as const;
type Kind = (typeof kinds)[number];

function change(
  kind: Kind,
  mutations: MemoryMutations,
  options: {
    requestId?: string;
    different?: boolean;
    unchanged?: boolean;
  } = {},
  signal?: AbortSignal
) {
  const scope = { memoryId: 'a', requestId: options.requestId ?? 'shared', expectedRevision: 1 };
  return kind === 'apply'
    ? mutations.apply(
        {
          ...scope,
          commands: options.unchanged
            ? []
            : [{ op: 'add', content: options.different ? 'different' : 'remember' }],
        },
        signal
      )
    : mutations.configure(
        {
          ...scope,
          config: options.unchanged
            ? {}
            : {
                maxContextTokens: options.different ? 1024 : 2048,
              },
        },
        signal
      );
}

/** Pause after a real missing-receipt read, not before that query or the snapshot read. */
function delayMissingReceipt(store: MemoryStore, cancelOnRecovery?: AbortController) {
  const entered = gate();
  const release = gate();
  let receiptReads = 0;
  const revisions: number[] = [];
  const delayed: MemoryStore = {
    read: async (memoryId, signal) => {
      const snapshot = await store.read(memoryId, signal);
      if (snapshot !== undefined) revisions.push(snapshot.revision);
      return snapshot;
    },
    getReceipt: async (memoryId, requestId, signal) => {
      const receipt = await store.getReceipt(memoryId, requestId, signal);
      if (++receiptReads === 1) {
        expect(receipt).toBeUndefined();
        entered.release();
        await release.promise;
      } else if (receipt !== undefined) cancelOnRecovery?.abort();
      return receipt;
    },
    commit: store.commit.bind(store),
  };
  return { entered, release, delayed, revisions, receiptReads: () => receiptReads };
}

it.each(kinds)(
  '%s recovers a concurrent same-request commit between receipt and snapshot reads',
  async (kind) => {
    const { first, second } = await fileStores();
    await domain(first).mutations.create({ memoryId: 'a', requestId: 'create' });
    const delayed = delayMissingReceipt(second);
    const replay = change(kind, domain(delayed.delayed).mutations);
    await delayed.entered.promise;
    const result = await change(kind, domain(first).mutations);
    delayed.release.release();
    expect(await replay).toEqual(result);
    expect(delayed.revisions).toEqual([2]);
    expect(delayed.receiptReads()).toBe(2);
    expect((await first.read('a'))?.revision).toBe(2);
  }
);

it.each(kinds)(
  '%s reports REQUEST_CONFLICT for reused identity with different input in that window',
  async (kind) => {
    const { first, second } = await fileStores();
    await domain(first).mutations.create({ memoryId: 'a', requestId: 'create' });
    const delayed = delayMissingReceipt(second);
    const replay = change(kind, domain(delayed.delayed).mutations, { different: true });
    await delayed.entered.promise;
    const winner = await change(kind, domain(first).mutations);
    delayed.release.release();
    await expect(replay).rejects.toMatchObject({
      code: 'REQUEST_CONFLICT',
      commit: { status: 'not-committed' },
    });
    if (winner.status === 'skipped') throw new Error('Unexpected skip.');
    expect(await first.getReceipt('a', 'shared')).toEqual(winner.receipt);
    expect((await first.read('a'))?.revision).toBe(2);
  }
);

it.each(kinds)(
  '%s still rejects genuine stale writes when no matching receipt exists',
  async (kind) => {
    const { first, second } = await fileStores();
    await domain(first).mutations.create({ memoryId: 'a', requestId: 'create' });
    const delayed = delayMissingReceipt(second);
    const operation = change(kind, domain(delayed.delayed).mutations);
    await delayed.entered.promise;
    await change(kind, domain(first).mutations, { requestId: 'unrelated' });
    delayed.release.release();
    await expect(operation).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
      commit: { status: 'not-committed' },
      details: { expectedRevision: 1, actualRevision: 2 },
    });
    expect(delayed.receiptReads()).toBe(2);
    expect(await first.getReceipt('a', 'shared')).toBeUndefined();
  }
);

it.each(kinds)(
  '%s restores an unchanged receipt even after another request advances revision',
  async (kind) => {
    const { first, second } = await fileStores();
    await domain(first).mutations.create({ memoryId: 'a', requestId: 'create' });
    const delayed = delayMissingReceipt(second);
    const replay = change(kind, domain(delayed.delayed).mutations, { unchanged: true });
    await delayed.entered.promise;
    const result = await change(kind, domain(first).mutations, { unchanged: true });
    expect(result).toMatchObject({ status: 'unchanged', receipt: { revision: 1 } });
    await change(kind, domain(first).mutations, { requestId: 'next' });
    delayed.release.release();
    expect(await replay).toEqual(result);
    expect((await first.read('a'))?.revision).toBe(2);
  }
);

it.each(kinds)(
  '%s preserves the recovered receipt when cancellation arrives during its read',
  async (kind) => {
    const { first, second } = await fileStores();
    await domain(first).mutations.create({ memoryId: 'a', requestId: 'create' });
    const controller = new AbortController();
    const delayed = delayMissingReceipt(second, controller);
    const replay = change(kind, domain(delayed.delayed).mutations, {}, controller.signal);
    await delayed.entered.promise;
    const result = await change(kind, domain(first).mutations);
    delayed.release.release();
    expect(await replay).toEqual(result);
    expect(controller.signal.aborted).toBe(true);
    expect((await first.read('a'))?.revision).toBe(2);
  }
);
