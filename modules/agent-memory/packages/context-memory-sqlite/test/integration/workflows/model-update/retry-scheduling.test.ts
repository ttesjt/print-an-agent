import { expect, it } from 'vitest';

import { modelFixture } from '../../../support/model.js';

it('lets a deadline fire while finite compaction uses immediately resolved capabilities', async () => {
  const fixture = modelFixture(() => [], {
    policy: { timeoutMs: 1, maxCompactionPasses: 300 },
  });
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  await expect(
    fixture.bundle.workflows.compact.run({
      input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 2 } },
    })
  ).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT', commit: { status: 'not-committed' } });
  expect(fixture.requests.length).toBeLessThan(300);
  expect((await fixture.store.read('a'))?.revision).toBe(1);
  expect(await fixture.store.getReceipt('a', 'compact')).toBeUndefined();
});

it('allows an external timer to cancel unbounded immediate compaction', async () => {
  const fixture = modelFixture(
    (_request, call) => {
      // A regression must fail rather than hang Vitest's own starved timeout indefinitely.
      if (call === 1000) throw new Error('Compaction starved the external timer.');
      return [];
    },
    { policy: { timeoutMs: null, maxCompactionPasses: null } }
  );
  await fixture.bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'long text' }] },
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5);
  try {
    await expect(
      fixture.bundle.workflows.compact.run({
        input: { memoryId: 'a', requestId: 'compact', target: { maxTokens: 2 } },
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: 'OPERATION_ABORTED', commit: { status: 'not-committed' } });
    expect(controller.signal.aborted).toBe(true);
    expect(await fixture.store.getReceipt('a', 'compact')).toBeUndefined();
  } finally {
    clearTimeout(timer);
  }
});

it.each(['parent', 'deadline'] as const)(
  'allows $0 cancellation between unbounded CAS replan cycles',
  async (owner) => {
    const fixture = modelFixture(
      async (_request, call) => {
        if (call === 100) throw new Error('CAS replanning starved the external timer.');
        const source = await fixture.store.read('a');
        if (source === undefined) throw new Error('Missing document.');
        await fixture.mutations.apply({
          memoryId: 'a',
          requestId: `external-${call}`,
          expectedRevision: source.revision,
          commands: [{ op: 'add', content: 'x' }],
        });
        return [];
      },
      { policy: { timeoutMs: owner === 'deadline' ? 1 : null, maxConflictRetries: null } }
    );
    await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
    const controller = new AbortController();
    const timer = owner === 'parent' ? setTimeout(() => controller.abort(), 5) : undefined;
    try {
      await expect(
        fixture.bundle.workflows.edit.run({
          input: { memoryId: 'a', requestId: 'edit', instruction: 'learn' },
          signal: controller.signal,
        })
      ).rejects.toMatchObject({
        code: owner === 'parent' ? 'OPERATION_ABORTED' : 'OPERATION_TIMEOUT',
        commit: { status: 'not-committed' },
      });
      expect(controller.signal.aborted).toBe(owner === 'parent');
      expect(await fixture.store.getReceipt('a', 'edit')).toBeUndefined();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
);
