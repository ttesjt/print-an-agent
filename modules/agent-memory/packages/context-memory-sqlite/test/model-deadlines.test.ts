import { afterEach, expect, it, vi } from 'vitest';
import { modelFixture } from './support/model.js';

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
