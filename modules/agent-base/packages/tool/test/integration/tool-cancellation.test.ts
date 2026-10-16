import { afterEach, expect, it, vi } from 'vitest';
import {
  createBoundedToolRuntime,
  createToolRegistry,
  DEFAULT_TOOL_EXECUTION_POLICY,
  defineTool,
  defineToolPermissionPolicy,
} from '../../src/index.js';

const proposal = { callId: 'call', toolName: 'work', arguments: {} };

function runtimeFor(signal: AbortSignal, execute: (signal: AbortSignal) => Promise<void>) {
  return createBoundedToolRuntime({
    signal,
    executionPolicy: { ...DEFAULT_TOOL_EXECUTION_POLICY, toolTimeoutMilliseconds: 50 },
    permissionPolicy: defineToolPermissionPolicy({
      responsibility: ['work'],
      actor: ['work'],
      product: ['work'],
      runtime: ['work'],
    }),
    registry: createToolRegistry([
      defineTool({
        name: 'work',
        description: 'Cooperative work.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        execute: async ({ signal }) => {
          await execute(signal);
          return { text: 'done' };
        },
      }),
    ]),
  });
}

afterEach(() => vi.useRealTimers());

it.each(['owner', 'call', 'timeout'] as const)(
  'preserves %s cancellation, drains the handler, and clears its timer',
  async (source) => {
    vi.useFakeTimers();
    const owner = new AbortController();
    const call = new AbortController();
    const started = Promise.withResolvers<AbortSignal>();
    const release = Promise.withResolvers<void>();
    const cancellation = new Error('cancel');
    const runtime = runtimeFor(owner.signal, async (signal) => {
      started.resolve(signal);
      await release.promise;
      // Even a handler that returns successfully after cancellation cannot publish success.
    });
    const run = runtime.execute(proposal, { signal: call.signal });
    const expectedCode =
      source === 'timeout' ? 'TOOL_EXECUTION_TIMEOUT' : 'TOOL_EXECUTION_CANCELLED';
    const expectation = expect(run).rejects.toMatchObject({ code: expectedCode });
    let settled = false;
    void run.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    try {
      const signal = await started.promise;
      expect(vi.getTimerCount()).toBe(1);
      if (source === 'timeout') await vi.advanceTimersByTimeAsync(50);
      else (source === 'owner' ? owner : call).abort(cancellation);
      expect(signal.aborted).toBe(true);
      if (source !== 'timeout') expect(signal.reason).toBe(cancellation);
      expect(owner.signal.aborted).toBe(source === 'owner');
      expect(call.signal.aborted).toBe(source === 'call');
      expect(vi.getTimerCount()).toBe(0);
      // Later sources during cleanup cannot replace the first source's classification.
      owner.abort(new Error('later owner cancellation'));
      call.abort(new Error('later call cancellation'));
      await vi.advanceTimersByTimeAsync(100);
      expect(settled).toBe(false);
      expect(runtime.inspect().records).toEqual([]);
    } finally {
      release.resolve();
      await expectation;
    }
    expect(runtime.inspect().records).toMatchObject([
      { status: 'rejected', errorCode: expectedCode },
    ]);
  }
);

it.each(['owner', 'call'] as const)(
  'does not dispatch a queued call cancelled by its %s',
  async (source) => {
    const owner = new AbortController();
    const call = new AbortController();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const handler = vi.fn(async () => {
      started.resolve();
      await release.promise;
    });
    const runtime = runtimeFor(owner.signal, handler);
    const first = runtime.execute(proposal);
    const firstSettled = first.catch(() => undefined);
    await started.promise;
    const second = runtime.execute({ ...proposal, callId: 'queued' }, { signal: call.signal });
    const expectation = expect(second).rejects.toMatchObject({ code: 'TOOL_EXECUTION_CANCELLED' });
    (source === 'owner' ? owner : call).abort();
    release.resolve();
    await firstSettled;
    await expectation;
    expect(handler).toHaveBeenCalledOnce();
  }
);

it.each([false, true])('clears the timer after settlement (handler failure: %s)', async (fail) => {
  vi.useFakeTimers();
  let receivedSignal: AbortSignal | undefined;
  const runtime = runtimeFor(new AbortController().signal, (signal) => {
    receivedSignal = signal;
    return fail ? Promise.reject(new Error('private')) : Promise.resolve();
  });
  await expect(runtime.execute(proposal)).resolves.toMatchObject({
    status: fail ? 'handler-error' : 'success',
  });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(receivedSignal?.aborted).toBe(false);
});
