import { expect, it, vi } from 'vitest';
import { AgentToolError } from '../../../src/index.js';
import { policy, runtimeFor } from '../../support/broker.js';

it('executes an authorized call exactly once and exposes immutable metadata only', async () => {
  const { runtime, handler } = runtimeFor((value) => Promise.resolve(value.toUpperCase()));
  const outcome = await runtime.execute({
    callId: 'call-1',
    toolName: 'echo',
    arguments: { value: 'private-value' },
  });
  runtime.close();

  expect(outcome).toEqual({ status: 'success', text: 'PRIVATE-VALUE' });
  expect(handler).toHaveBeenCalledTimes(1);
  expect(runtime.inspect()).toEqual({
    status: 'closed',
    effectiveTools: [expect.objectContaining({ name: 'echo' })],
    records: [
      {
        callId: 'call-1',
        toolName: 'echo',
        status: 'success',
        resultCharacters: 13,
        startedAt: 1,
        completedAt: 2,
      },
    ],
    totalResultCharacters: 13,
  });
  expect(JSON.stringify(runtime.inspect())).not.toContain('private-value');
  expect(Object.isFrozen(runtime.inspect().records)).toBe(true);
});

it('serializes concurrent proposals in arrival order', async () => {
  let releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const starts: string[] = [];
  const { runtime } = runtimeFor(async (value) => {
    starts.push(value);
    if (value === 'first') await firstGate;
    return value;
  });

  const first = runtime.execute({
    callId: 'first',
    toolName: 'echo',
    arguments: { value: 'first' },
  });
  const second = runtime.execute({
    callId: 'second',
    toolName: 'echo',
    arguments: { value: 'second' },
  });
  await vi.waitFor(() => expect(starts).toEqual(['first']));
  releaseFirst?.();

  await expect(Promise.all([first, second])).resolves.toEqual([
    { status: 'success', text: 'first' },
    { status: 'success', text: 'second' },
  ]);
  expect(starts).toEqual(['first', 'second']);
});

it('normalizes ordinary handler failure into a bounded recoverable result', async () => {
  const { runtime } = runtimeFor(() => Promise.reject(new Error('private handler detail')));

  await expect(
    runtime.execute({ callId: 'handler-error', toolName: 'echo', arguments: { value: 'x' } })
  ).resolves.toEqual({ status: 'handler-error', text: 'Tool execution failed.' });
  expect(JSON.stringify(runtime.inspect())).not.toContain('private handler detail');
});

it('enforces timeout and caller cancellation through a cooperative handler', async () => {
  const untilCancelled = (_value: string, signal: AbortSignal) =>
    new Promise<string>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          const reason: unknown = signal.reason;
          reject(
            reason instanceof Error ? reason : new Error('Tool was cancelled.', { cause: reason })
          );
        },
        { once: true }
      );
    });
  const timed = runtimeFor(untilCancelled, {
    executionPolicy: policy({ toolTimeoutMilliseconds: 5 }),
  });
  await expect(
    timed.runtime.execute({ callId: 'timeout', toolName: 'echo', arguments: { value: 'x' } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_EXECUTION_TIMEOUT' })
  );

  const controller = new AbortController();
  const cancelled = runtimeFor(untilCancelled, { signal: controller.signal });
  const executing = cancelled.runtime.execute({
    callId: 'cancelled',
    toolName: 'echo',
    arguments: { value: 'x' },
  });
  controller.abort();
  await expect(executing).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_EXECUTION_CANCELLED' })
  );
});

it('enforces per-result, cumulative-result, and closed-run bounds', async () => {
  const oversized = runtimeFor(() => Promise.resolve('long'), {
    executionPolicy: policy({ maxResultCharacters: 3 }),
  });
  await expect(
    oversized.runtime.execute({
      callId: 'large-result',
      toolName: 'echo',
      arguments: { value: 'x' },
    })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_RESULT_TOO_LARGE' })
  );

  const cumulative = runtimeFor(() => Promise.resolve('abc'), {
    executionPolicy: policy({ maxResultCharacters: 3, maxTotalResultCharacters: 5 }),
  });
  await cumulative.runtime.execute({
    callId: 'first',
    toolName: 'echo',
    arguments: { value: 'x' },
  });
  await expect(
    cumulative.runtime.execute({ callId: 'second', toolName: 'echo', arguments: { value: 'x' } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({
      code: 'TOOL_TOTAL_RESULT_BUDGET_EXCEEDED',
    })
  );

  cumulative.runtime.close();
  await expect(
    cumulative.runtime.execute({ callId: 'late', toolName: 'echo', arguments: { value: 'x' } })
  ).rejects.toEqual(expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_RUN_CLOSED' }));
});
