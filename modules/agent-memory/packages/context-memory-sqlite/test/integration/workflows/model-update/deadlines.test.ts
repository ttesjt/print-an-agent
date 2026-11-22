import { afterEach, expect, it, vi } from 'vitest';

import { createMemoryEditDefinition } from '@print-an-agent/context-memory';

import { modelFixture } from '../../../support/model.js';

afterEach(() => vi.useRealTimers());

it.each(['parent', 'memory'] as const)(
  'keeps a narrower Actor deadline authoritative when %s cancels during drain',
  async (later) => {
    const controller = new AbortController();
    const fixture = modelFixture(
      (_request, _call, signal) =>
        new Promise((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => {
                if (later === 'parent') controller.abort();
                resolve([]);
              }, 20);
            },
            { once: true }
          );
        }),
      { actorTimeoutMs: 10, policy: { timeoutMs: later === 'memory' ? 20 : null } }
    );
    await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
    vi.useFakeTimers();
    const pending = fixture.bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'learn' },
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'MODEL_INVOCATION_FAILED',
      cause: { code: 'ACTOR_INVOCATION_TIMEOUT' },
      commit: { status: 'not-committed' },
    });
    await vi.advanceTimersByTimeAsync(30);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    expect(await fixture.store.getReceipt('a', 'edit')).toBeUndefined();
    expect(fixture.requests).toHaveLength(1);
  }
);

it('retains the durable receipt when the model deadline expires after the commit Step writes', async () => {
  const committed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const timeoutMs = 100;
  const fixture = modelFixture(() => [{ op: 'add', content: 'new' }], {
    policy: { timeoutMs },
    workflows: {
      edit: createMemoryEditDefinition({
        async executeStep({ stepName, step, context }) {
          await step(context);
          if (stepName === 'commitCandidate') {
            committed.resolve();
            await release.promise;
          }
        },
      }),
    },
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  vi.useFakeTimers();
  const pending = fixture.bundle.workflows.edit.run({
    input: { memoryId: 'a', requestId: 'edit', instruction: 'learn' },
  });
  // Observe early failure too so the test cannot leak a rejection while waiting for the commit.
  const outcome = pending.catch((error: unknown) => error);
  try {
    await Promise.race([committed.promise, outcome]);
    const receipt = await fixture.store.getReceipt('a', 'edit');
    expect(receipt).toMatchObject({ status: 'committed', revision: 2 });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    release.resolve();
    expect(await outcome).toMatchObject({
      code: 'OPERATION_TIMEOUT',
      commit: { status: 'committed', receipt },
    });
  } finally {
    release.resolve();
    await outcome;
  }
});
