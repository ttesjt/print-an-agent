import {
  AgentToolError,
  createBoundedToolRuntime,
  createToolRegistry,
  DEFAULT_TOOL_EXECUTION_POLICY,
  defineTool,
  defineToolPermissionPolicy,
  type ToolExecutionRequest,
  type ToolExecutionPolicy,
} from '../../src/index.js';
import { describe, expect, it, vi } from 'vitest';

const inputSchema = {
  type: 'object',
  properties: { value: { type: 'string', maxLength: 100 } },
  required: ['value'],
  additionalProperties: false,
} as const;

const allowed = defineToolPermissionPolicy({
  task: ['echo'],
  assignment: ['echo'],
  product: ['echo'],
  runtime: ['echo'],
});

function policy(overrides: Partial<ToolExecutionPolicy> = {}): ToolExecutionPolicy {
  return { ...DEFAULT_TOOL_EXECUTION_POLICY, ...overrides };
}

function runtimeFor(
  execute: (value: string, signal: AbortSignal) => Promise<string>,
  options: { executionPolicy?: ToolExecutionPolicy; signal?: AbortSignal } = {}
) {
  const handler = vi.fn(async ({ arguments: input, signal }: ToolExecutionRequest<EchoInput>) => ({
    text: await execute(input.value, signal),
  }));
  const tool = defineTool({
    name: 'echo',
    description: 'Returns a deterministic value.',
    parameters: inputSchema,
    execute: handler,
  });
  let now = 0;
  const runtime = createBoundedToolRuntime({
    registry: createToolRegistry([tool]),
    permissionPolicy: allowed,
    executionPolicy: options.executionPolicy ?? DEFAULT_TOOL_EXECUTION_POLICY,
    signal: options.signal ?? new AbortController().signal,
    clock: () => ++now,
  });
  return { runtime, handler };
}

type EchoInput = Readonly<{ value: string }>;

describe('bounded Tool Broker runtime', () => {
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

  it('normalizes ordinary handler failure into a bounded recoverable result', async () => {
    const { runtime } = runtimeFor(() => Promise.reject(new Error('private handler detail')));

    await expect(
      runtime.execute({ callId: 'handler-error', toolName: 'echo', arguments: { value: 'x' } })
    ).resolves.toEqual({ status: 'handler-error', text: 'Tool execution failed.' });
    expect(JSON.stringify(runtime.inspect())).not.toContain('private handler detail');
  });

  it('enforces timeout and caller cancellation even when a handler does not settle', async () => {
    const never = () => new Promise<string>(() => undefined);
    const timed = runtimeFor(never, {
      executionPolicy: policy({ toolTimeoutMilliseconds: 5 }),
    });
    await expect(
      timed.runtime.execute({ callId: 'timeout', toolName: 'echo', arguments: { value: 'x' } })
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_EXECUTION_TIMEOUT' })
    );

    const controller = new AbortController();
    const cancelled = runtimeFor(never, { signal: controller.signal });
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
    ).rejects.toEqual(
      expect.objectContaining<Partial<AgentToolError>>({ code: 'TOOL_RUN_CLOSED' })
    );
  });
});
