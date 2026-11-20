import { createAgentTraceEmitter, type AgentTraceEvent } from '@print-an-agent/base-observability';
import { RUN_WORKFLOW, skipWorkflow } from '@print-an-agent/workflow-core';
import { expect, it, vi } from 'vitest';
import { bindAgentWorkflow } from '../../../src/index.js';
import { context, workflow, type Run } from '../../support/workflow-binding.js';

interface Input {
  readonly message: string;
}

it('projects once before initialization and keeps execution signal and tracing on the source Run', async () => {
  const order: string[] = [];
  const events: AgentTraceEvent[] = [];
  const run: Run = {
    ...context(),
    traceEmitter: createAgentTraceEmitter({
      agentId: 'agent',
      agentRunId: 'agent-run',
      sink: {
        record: (event) => {
          events.push(event);
          return Promise.resolve();
        },
      },
    }),
  };
  const projected = Object.freeze({ message: 'projected' });
  const projectInput = vi.fn((_source: Run): Input => {
    order.push('project');
    return projected;
  });
  const core = workflow<Input>({
    condition: ({ input, signal }) => {
      order.push('condition');
      expect(input).toBe(projected);
      expect(signal.aborted).toBe(false);
      return RUN_WORKFLOW;
    },
    createState: ({ input }) => {
      order.push('state');
      expect(input).toBe(projected);
      return { output: input.message };
    },
    stepOverrides: {
      entry: async (ctx) => {
        order.push('step');
        expect(ctx.signal.aborted).toBe(false);
        expect(ctx.parentRunId).toBe(run.runId);
        expect(ctx.state).toEqual({ output: 'projected' });
        await ctx.runStep('child');
      },
    },
  });
  const execute = vi.spyOn(core, 'run');
  const binding = bindAgentWorkflow({
    projectInput,
    workflow: core,
    applyResult: (target, result) => {
      if (result !== undefined) target.output = result;
    },
  });
  expect(projectInput).not.toHaveBeenCalled();
  const result = await binding.run(run);
  expect(order).toEqual(['project', 'condition', 'state', 'step']);
  expect(projectInput).toHaveBeenCalledExactlyOnceWith(run);
  expect(execute).toHaveBeenCalledWith(
    expect.objectContaining({
      input: projected,
      signal: run.signal,
      parentRunId: run.runId,
    })
  );
  expect(result.result).toBe('projected');
  expect(run.output).toBeUndefined();
  await result.applyTo(run);
  expect(run.output).toBe('projected');
  await run.traceEmitter?.record({ type: 'agent-run-completed', operationName: 'request' });
  expect(events.find((event) => event.type === 'workflow-run-completed')).toMatchObject({
    agentId: 'agent',
    agentRunId: 'agent-run',
    workflowName: 'test',
  });
});

it('inherits caller cancellation even when projected input contains an unrelated signal', async () => {
  const source = new AbortController();
  const unrelated = new AbortController();
  const run = context(source.signal);
  const entered = Promise.withResolvers<void>();
  const reason = new Error('caller cancelled');
  const applyResult = vi.fn();
  const binding = bindAgentWorkflow({
    projectInput: (_run: Run) => ({ message: 'input', signal: unrelated.signal, runId: 'other' }),
    workflow: workflow<Input & { signal: AbortSignal; runId: string }>({
      condition: ({ input, signal }) => {
        expect(input.signal).toBe(unrelated.signal);
        expect(signal).not.toBe(unrelated.signal);
        return RUN_WORKFLOW;
      },
      stepOverrides: {
        entry: async (ctx) => {
          expect(ctx.parentRunId).toBe(run.runId);
          await new Promise<void>((_resolve, reject) => {
            const abort = () => {
              const cause: unknown = ctx.signal.reason;
              reject(cause instanceof Error ? cause : new Error('Cancelled.', { cause }));
            };
            if (ctx.signal.aborted) abort();
            else ctx.signal.addEventListener('abort', abort, { once: true });
            entered.resolve();
          });
        },
      },
    }),
    applyResult,
  });
  const pending = binding.run(run);
  const checked = expect(pending).rejects.toBe(reason);
  try {
    await entered.promise;
    source.abort(reason);
    await checked;
    expect(unrelated.signal.aborted).toBe(false);
    expect(applyResult).not.toHaveBeenCalled();
  } finally {
    source.abort(reason);
  }
});

it('passes projected input to condition skips without constructing state or changing result ownership', async () => {
  const run = context();
  const projected = Object.freeze({ message: 'skip input' });
  const createState = vi.fn(() => ({}));
  const createSkippedResult = vi.fn(({ input }: { input: Input }) => input.message);
  const binding = bindAgentWorkflow({
    projectInput: (_run: Run) => projected,
    workflow: workflow<Input>({
      condition: ({ input }) => {
        expect(input).toBe(projected);
        return skipWorkflow('not-needed');
      },
      createState,
      createSkippedResult,
    }),
    applyResult: (target, result) => {
      if (result !== undefined) target.output = result;
    },
  });
  const result = await binding.run(run);
  expect(result.result).toBe('skip input');
  expect(createState).not.toHaveBeenCalled();
  expect(createSkippedResult).toHaveBeenCalledExactlyOnceWith({
    input: projected,
    reason: 'not-needed',
  });
  await expect(result.applyTo(context())).rejects.toMatchObject({
    code: 'WORKFLOW_RESULT_CONTEXT_MISMATCH',
  });
  await result.applyTo(run);
  expect(run.output).toBe('skip input');
});

it('preserves a projection failure before Workflow admission or result application', async () => {
  const failure = new Error('projection failed');
  const condition = vi.fn(() => RUN_WORKFLOW);
  const createState = vi.fn(() => ({}));
  const onError = vi.fn();
  const onFinally = vi.fn();
  const applyResult = vi.fn();
  const run: Run = { ...context(), output: 'existing' };
  const binding = bindAgentWorkflow({
    projectInput: (_run: Run): Input => {
      throw failure;
    },
    workflow: workflow<Input>({ condition, createState, lifecycle: { onError, onFinally } }),
    applyResult,
  });
  await expect(binding.run(run)).rejects.toBe(failure);
  expect(condition).not.toHaveBeenCalled();
  expect(createState).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(onFinally).not.toHaveBeenCalled();
  expect(applyResult).not.toHaveBeenCalled();
  expect(run.output).toBe('existing');
});

it('reprojects each concurrent invocation without sharing state or applying to another Run', async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const first: Run = { ...context(), runId: 'first', input: 'first input' };
  const second: Run = { ...context(), runId: 'second', input: 'second input' };
  const projectInput = vi.fn((run: Run): Input => ({ message: run.input }));
  const binding = bindAgentWorkflow({
    projectInput,
    workflow: workflow<Input>({
      createState: ({ input }) => ({ output: input.message }),
      stepOverrides: {
        entry: async (ctx) => {
          if (ctx.state.output === first.input) {
            entered.resolve();
            await release.promise;
          }
        },
      },
    }),
    applyResult: (run, result) => {
      if (result !== undefined) run.output = result;
    },
  });
  const pending = binding.run(first);
  try {
    await entered.promise;
    const completed = await binding.run(second);
    expect(completed.result).toBe('second input');
    await expect(completed.applyTo(first)).rejects.toMatchObject({
      code: 'WORKFLOW_RESULT_CONTEXT_MISMATCH',
    });
    await completed.applyTo(second);
    expect(second.output).toBe('second input');
    expect(first.output).toBeUndefined();
  } finally {
    release.resolve();
  }
  const completed = await pending;
  expect(completed.result).toBe('first input');
  await completed.applyTo(first);
  expect(first.output).toBe('first input');
  expect(projectInput).toHaveBeenCalledTimes(2);
  expect(projectInput.mock.results[0]?.value).not.toBe(projectInput.mock.results[1]?.value);
});

it('rejects a missing or non-callable projector when defining a binding', () => {
  const captureFailure = (define: () => unknown): unknown => {
    try {
      define();
    } catch (cause: unknown) {
      return cause;
    }
    throw new Error('Expected an invalid projection definition.');
  };
  expect(
    captureFailure(() => {
      // @ts-expect-error JavaScript consumers must also provide an explicit projection.
      bindAgentWorkflow({ workflow: workflow(), applyResult: () => undefined });
    })
  ).toMatchObject({ code: 'WORKFLOW_INPUT_PROJECTION_INVALID', subjectName: 'test' });
  expect(
    captureFailure(() =>
      bindAgentWorkflow({
        workflow: workflow(),
        // @ts-expect-error Exercise the JavaScript definition boundary without a type assertion.
        projectInput: false,
        applyResult: () => undefined,
      })
    )
  ).toMatchObject({ code: 'WORKFLOW_INPUT_PROJECTION_INVALID' });
});
