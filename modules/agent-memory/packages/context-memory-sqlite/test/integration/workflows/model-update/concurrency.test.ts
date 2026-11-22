import { expect, it } from 'vitest';

import {
  createContextMemoryBundle,
  createModelMemoryResources,
  MemoryMeter,
  type ModelEditOperation,
} from '@print-an-agent/context-memory';

import { ModelInvocationError } from '@print-an-agent/model-invocation-core';

import { modelFixture } from '../../../support/model.js';

import { gate, borrowed } from '../../../support/fixtures.js';

import { testCounter } from '../../../support/counter.js';

it('replans with the latest source/config and original instruction after a real CAS conflict', async () => {
  const entered = gate();
  const release = gate();
  const fixture = modelFixture(async (_request, call) => {
    if (call === 1) {
      entered.release();
      await release.promise;
    }
    return [{ op: 'add', content: 'learned' }];
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'keep original instruction' };
  const pending = fixture.bundle.workflows.edit.run({ input });
  await entered.promise;
  input.instruction = 'caller changed this object';
  await fixture.mutations.apply({
    memoryId: 'a',
    requestId: 'external',
    expectedRevision: 1,
    commands: [{ op: 'add', content: 'external' }],
  });
  await fixture.mutations.configure({
    memoryId: 'a',
    requestId: 'config',
    expectedRevision: 2,
    config: { render: { format: 'text', separator: '|' } },
  });
  release.release();
  await pending;
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[0]?.source).toHaveLength(0);
  expect(fixture.requests[1]?.source[0]?.content).toBe('external');
  expect(fixture.requests[1]?.instruction).toBe('keep original instruction');
  const snapshot = await fixture.store.read('a');
  expect(snapshot?.revision).toBe(4);
  expect(snapshot?.items.map((item) => item.content)).toEqual(['external', 'learned']);
  expect(snapshot?.config.render).toEqual({ format: 'text', separator: '|' });
});

it.each([
  { limit: 0, calls: 1 },
  { limit: 2, calls: 3 },
  { limit: null, calls: 4 },
])('uses its independent CAS retry count with limit $limit', async ({ limit, calls }) => {
  const fixture = modelFixture(
    async (_request, call) => {
      if (limit !== null || call < 4) {
        const snapshot = await fixture.store.read('a');
        if (snapshot === undefined) throw new Error('Missing source.');
        await fixture.mutations.apply({
          memoryId: 'a',
          requestId: `external-${call}`,
          expectedRevision: snapshot.revision,
          commands: [{ op: 'add', content: 'external' }],
        });
      }
      return [];
    },
    { policy: { maxConflictRetries: limit } }
  );
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const pending = fixture.bundle.workflows.observe.run({
    input: { memoryId: 'a', requestId: 'observe', context: [] },
  });
  if (limit === null) expect(await pending).toMatchObject({ status: 'unchanged' });
  else
    await expect(pending).rejects.toMatchObject({
      code: 'CONFLICT_RETRIES_EXHAUSTED',
      details: { retries: limit },
    });
  expect(fixture.requests).toHaveLength(calls);
  if (limit === null) expect(await fixture.store.getReceipt('a', 'observe')).toBeDefined();
  else expect(await fixture.store.getReceipt('a', 'observe')).toBeUndefined();
});

it('does not retry provider/protocol/storage-unknown failures as business conflicts', async () => {
  const provider = modelFixture(() => {
    throw new ModelInvocationError('MODEL_PROVIDER_FAILED', 'provider unavailable');
  });
  await provider.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await expect(
    provider.bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
    })
  ).rejects.toMatchObject({ code: 'MODEL_INVOCATION_FAILED' });
  expect(provider.requests).toHaveLength(1);

  const base = borrowed();
  let commits = 0;
  let plans = 0;
  const unknownStore = {
    read: base.store.read.bind(base.store),
    getReceipt: base.store.getReceipt.bind(base.store),
    commit: () => {
      commits++;
      return Promise.reject(new Error('commit response unavailable'));
    },
  };
  const bundle = createContextMemoryBundle({
    resources: createModelMemoryResources({
      store: unknownStore,
      meter: new MemoryMeter({ counter: testCounter() }),
      defaults: { measurementRef: 'chars' },
      planner: {
        plan: () => {
          plans++;
          return Promise.resolve<readonly ModelEditOperation[]>([{ op: 'add', content: 'new' }]);
        },
      },
    }),
  });
  await base.mutations.create({ memoryId: 'a', requestId: 'create' });
  await expect(
    bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
    })
  ).rejects.toMatchObject({ code: 'COMMIT_STATUS_UNKNOWN', commit: { status: 'unknown' } });
  expect(plans).toBe(1);
  expect(commits).toBe(1);
});

it('keeps simultaneous Memory model runs isolated when cancelling one', async () => {
  const entered = gate();
  const release = gate();
  const fixture = modelFixture(async (request) => {
    if (request.instruction === 'hold') {
      entered.release();
      await release.promise;
    }
    return [{ op: 'add', content: 'new' }];
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'b', requestId: 'create' } });
  const controller = new AbortController();
  const pending = fixture.bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'hold' },
    signal: controller.signal,
  });
  await entered.promise;
  expect(
    await fixture.bundle.workflows.edit.run({
      input: { memoryId: 'b', requestId: 'edit', instruction: 'other' },
    })
  ).toMatchObject({ status: 'committed' });
  controller.abort();
  release.release();
  await expect(pending).rejects.toMatchObject({ code: 'OPERATION_ABORTED' });
  expect((await fixture.store.read('a'))?.revision).toBe(1);
  expect((await fixture.store.read('b'))?.revision).toBe(2);
});

it('resets the inner compaction count per CAS cycle without resetting the outer retry count', async () => {
  let compactCalls = 0;
  const fixture = modelFixture(
    async (request) => {
      const first = request.items[0];
      if (first === undefined) throw new Error('Missing item.');
      if (request.task === 'edit')
        return [{ op: 'replace', itemId: first.id, content: 'x'.repeat(20) }];
      if (++compactCalls === 1)
        await fixture.mutations.apply({
          memoryId: 'a',
          requestId: 'external',
          expectedRevision: 1,
          commands: [{ op: 'add', content: 'new' }],
        });
      return [
        { op: 'replace', itemId: first.id, content: 'short' },
        ...request.items.slice(1).map((item) => ({ op: 'remove' as const, itemId: item.id })),
      ];
    },
    {
      defaults: { maxContextTokens: 10 },
      policy: { maxConflictRetries: 1, maxCompactionPasses: 1 },
    }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'start' }] },
  });
  await fixture.bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
  });
  expect(fixture.requests.map((request) => request.task)).toEqual([
    'edit',
    'compact',
    'edit',
    'compact',
  ]);
  expect((await fixture.store.read('a'))?.revision).toBe(3);
});
