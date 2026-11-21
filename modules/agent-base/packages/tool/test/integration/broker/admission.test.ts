import { expect, it } from 'vitest';
import { AgentToolError } from '../../../src/index.js';
import { policy, runtimeFor } from '../../support/broker.js';

it('reserves call IDs and rejects duplicates without re-execution', async () => {
  const { runtime, handler } = runtimeFor((value) => Promise.resolve(value));
  await runtime.execute({ callId: 'same', toolName: 'echo', arguments: { value: 'first' } });

  await expect(
    runtime.execute({ callId: 'same', toolName: 'echo', arguments: { value: 'second' } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_CALL_DUPLICATE' })
  );
  expect(handler).toHaveBeenCalledTimes(1);
});

it('rejects malformed call identity before execution', async () => {
  const { runtime, handler } = runtimeFor((value) => Promise.resolve(value));

  await expect(
    runtime.execute({ callId: 'not valid', toolName: 'echo', arguments: { value: 'x' } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_CALL_ID_INVALID' })
  );
  expect(handler).not.toHaveBeenCalled();
});

it('rejects malformed, unauthorized, oversized, and over-budget calls before handlers', async () => {
  const { runtime, handler } = runtimeFor((value) => Promise.resolve(value), {
    executionPolicy: policy({ maxToolCalls: 3, maxArgumentCharacters: 20 }),
  });

  await expect(
    runtime.execute({ callId: 'bad-args', toolName: 'echo', arguments: { value: 1 } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_ARGUMENTS_INVALID' })
  );
  await expect(
    runtime.execute({ callId: 'unauthorized', toolName: 'missing', arguments: {} })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_NOT_AUTHORIZED' })
  );
  await expect(
    runtime.execute({ callId: 'large', toolName: 'echo', arguments: { value: 'x'.repeat(50) } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_ARGUMENTS_TOO_LARGE' })
  );
  await expect(
    runtime.execute({ callId: 'over-budget', toolName: 'echo', arguments: { value: 'x' } })
  ).rejects.toEqual(
    expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_CALL_BUDGET_EXCEEDED' })
  );
  expect(handler).not.toHaveBeenCalled();
});

it('reserves rejected call IDs and counts them toward the call budget', async () => {
  const { runtime, handler } = runtimeFor((value) => Promise.resolve(value), {
    executionPolicy: policy({ maxToolCalls: 2 }),
  });
  const rejected = { callId: 'rejected', toolName: 'missing', arguments: {} };
  await expect(runtime.execute(rejected)).rejects.toMatchObject({ code: 'TOOL_NOT_AUTHORIZED' });
  await expect(runtime.execute(rejected)).rejects.toMatchObject({ code: 'TOOL_CALL_DUPLICATE' });
  await runtime.execute({ callId: 'accepted', toolName: 'echo', arguments: { value: 'ok' } });
  await expect(
    runtime.execute({ callId: 'over-budget', toolName: 'echo', arguments: { value: 'extra' } })
  ).rejects.toMatchObject({ code: 'TOOL_CALL_BUDGET_EXCEEDED' });
  expect(handler).toHaveBeenCalledOnce();
  expect(runtime.inspect().records.map(({ callId, status }) => ({ callId, status }))).toEqual([
    { callId: 'rejected', status: 'rejected' },
    { callId: 'accepted', status: 'success' },
    { callId: 'over-budget', status: 'rejected' },
  ]);
  expect(runtime.inspect().totalResultCharacters).toBe(2);
});

it('retains serialization failure causes and reserves identity before recording an outcome', async () => {
  const { runtime, handler } = runtimeFor((value) => Promise.resolve(value));
  const arguments_: Record<string, unknown> = {};
  arguments_.self = arguments_;
  const proposal = { callId: 'circular', toolName: 'echo', arguments: arguments_ };
  await expect(runtime.execute(proposal)).rejects.toSatisfy(
    (error: unknown) =>
      error instanceof AgentToolError &&
      error.code === 'TOOL_ARGUMENTS_INVALID' &&
      error.cause instanceof TypeError
  );
  await expect(runtime.execute(proposal)).rejects.toMatchObject({ code: 'TOOL_CALL_DUPLICATE' });
  expect(handler).not.toHaveBeenCalled();
  expect(runtime.inspect().records).toEqual([]);
});

it('checks closure before parsing a queued proposal after active work settles', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { runtime, handler } = runtimeFor(async (value) => {
    started.resolve();
    await release.promise;
    return value;
  });
  const first = runtime.execute({ callId: 'active', toolName: 'echo', arguments: { value: 'ok' } });
  await started.promise;
  const queued = runtime.execute({ callId: 'not valid', toolName: 'echo', arguments: {} });
  const rejection = expect(queued).rejects.toMatchObject({ code: 'TOOL_RUN_CLOSED' });
  runtime.close();
  release.resolve();
  await first;
  await rejection;
  expect(handler).toHaveBeenCalledOnce();
  expect(runtime.inspect()).toMatchObject({
    status: 'closed',
    records: [{ callId: 'active', status: 'success' }],
  });
});
