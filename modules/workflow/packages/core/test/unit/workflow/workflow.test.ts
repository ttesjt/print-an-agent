import { describe, expect, it, vi } from 'vitest';
import {
  createSequentialStep,
  SKIP_STEP,
  skipWorkflow,
  Workflow,
  type WorkflowEvent,
} from '@print-an-agent/workflow-core';
import {
  gate,
  leaves,
  once,
  options,
  workflow,
  type Context,
  type Names,
} from '../../support/fixtures.js';

describe('Workflow data and lifecycle', () => {
  it('exposes transformed state to Steps, executors and hooks without raw input or result fields', async () => {
    const views: object[] = [];
    const flow = new Workflow<'main' | 'child', { message: string }, number, undefined, string>({
      name: 'message-length',
      resources: undefined,
      entryStep: 'main',
      createState: ({ input }) => input.message.length,
      createResult: (length) => String(length),
      stepDefinitions: {
        main: {
          skippable: false,
          cardinality: 'at-most-once',
          step: (context) => {
            views.push(context);
            return context.runStep('child');
          },
        },
        child: {
          skippable: false,
          cardinality: 'at-most-once',
          step: (context) => {
            views.push(context);
            expect(context.state).toBe(5);
            return Promise.resolve();
          },
        },
      },
      executeStep: async ({ step, context }) => {
        views.push(context);
        await step(context);
      },
      lifecycle: {
        onSuccess: (context) => {
          views.push(context);
        },
        onFinally: (context) => {
          views.push(context);
        },
      },
    });
    await expect(flow.run({ input: { message: 'hello' } })).resolves.toBe('5');
    expect(views).toHaveLength(6);
    expect(views.every((context) => !('input' in context) && !('result' in context))).toBe(true);
  });

  it('resolves leaf overrides inside a composite and permits full entry replacement', async () => {
    const main = createSequentialStep<Names, Context>(['a', 'b']);
    const flow = workflow(main, {
      stepOverrides: {
        a: (c) => {
          c.state.values = [12];
          return Promise.resolve();
        },
        b: SKIP_STEP,
      },
    });
    expect(await flow.run(options())).toEqual([12]);
    expect(
      await workflow(main, {
        stepOverrides: {
          main: (c) => {
            c.state.values = [21];
            return Promise.resolve();
          },
        },
      }).run(options())
    ).toEqual([21]);
  });

  it('creates each skip result from the decision without running Steps, state creation or hooks', async () => {
    const order: string[] = [];
    const state = vi.fn(({ input }: { input: number }) => ({ input, values: [] }));
    const hook = vi.fn();
    const entry = vi.fn(() => Promise.resolve());
    const createResult = vi.fn(() => []);
    const flow = workflow(entry, {
      createResult,
      createSkippedResult: ({ input, reason }) => {
        order.push(reason);
        return [input];
      },
      createState: state,
      condition: () => {
        order.push('condition');
        return skipWorkflow('no changes');
      },
      lifecycle: { onSuccess: hook, onError: hook, onFinally: hook },
    });
    const a = await flow.run(options());
    const b = await flow.run(options());
    expect(a).toEqual([4]);
    expect(a).not.toBe(b);
    expect(order).toEqual(['condition', 'no changes', 'condition', 'no changes']);
    expect(entry).not.toHaveBeenCalled();
    expect(createResult).not.toHaveBeenCalled();
    expect(state).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('projects primitive state and preserves a legitimate undefined result', async () => {
    const scalar = new Workflow<'main', number, number, void, number>({
      name: 'scalar',
      resources: undefined,
      entryStep: 'main',
      createState: ({ input }) => input * 2,
      createResult: (value) => value,
      stepDefinitions: {
        main: { step: () => Promise.resolve(), skippable: false, cardinality: 'at-most-once' },
      },
    });
    expect(await scalar.run({ input: 3 })).toBe(6);
    const none = new Workflow<'main', void, void, void, void>({
      name: 'void',
      resources: undefined,
      entryStep: 'main',
      createState: () => undefined,
      createResult: () => undefined,
      stepDefinitions: {
        main: { step: () => Promise.resolve(), skippable: false, cardinality: 'at-most-once' },
      },
    });
    expect(await none.run({ input: undefined })).toBeUndefined();
  });

  it('rejects a condition skip without a result factory before creating state', async () => {
    const createState = vi.fn(() => ({ input: 0, values: [] }));
    const events: WorkflowEvent[] = [];
    await expect(
      workflow(() => Promise.resolve(), {
        condition: () => skipWorkflow('no changes'),
        createState,
      }).run({
        ...options(),
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).rejects.toMatchObject({ code: 'WORKFLOW_SKIP_RESULT_MISSING' });
    expect(createState).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['workflow-started', 'workflow-failed']);
  });

  it('projects after parallel work and onSuccess, then waits for onFinally before returning', async () => {
    const childStarted = gate();
    const releaseChild = gate();
    const cleanupStarted = gate();
    const releaseCleanup = gate();
    const project = vi.fn((state: Context['state']) => [...state.values]);
    const flow = workflow((context) => context.parallel(['a', 'b']), {
      stepOverrides: {
        b: async ({ state }) => {
          childStarted.resolve();
          await releaseChild.promise;
          state.values.push(5);
        },
      },
      createResult: project,
      lifecycle: {
        onSuccess({ state }) {
          state.values.push(6);
        },
        async onFinally({ state }) {
          cleanupStarted.resolve();
          state.values.push(7);
          await releaseCleanup.promise;
        },
      },
    });
    const settled = vi.fn();
    const run = flow.run(options()).then((value) => {
      settled();
      return value;
    });
    try {
      await childStarted.promise;
      expect(project).not.toHaveBeenCalled();
      releaseChild.resolve();
      await cleanupStarted.promise;
      expect(project).toHaveBeenCalledTimes(1);
      expect(settled).not.toHaveBeenCalled();
    } finally {
      releaseChild.resolve();
      releaseCleanup.resolve();
    }
    await expect(run).resolves.toEqual([4, 5, 6]);
  });

  it('preserves projection failure through onError and cleanup', async () => {
    const projection = new Error('projection');
    const cleanup = new Error('cleanup');
    const onError = vi.fn();
    const flow = workflow((context) => context.runStep('a'), {
      createResult() {
        throw projection;
      },
      lifecycle: {
        onError,
        onFinally() {
          throw cleanup;
        },
      },
    });
    await expect(flow.run(options())).rejects.toMatchObject({
      cause: projection,
      errors: [projection, cleanup],
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ state: { input: 4, values: [4] } }),
      projection
    );
  });

  it('isolates simultaneous runs and freezes execution fields without freezing business data', async () => {
    const ready = gate();
    let count = 0;
    const contexts: Context[] = [];
    const flow = workflow(async (c) => {
      contexts.push(c);
      if (++count === 2) ready.resolve();
      await ready.promise;
      await c.runStep('a');
    });
    expect(await Promise.all([flow.run(options()), flow.run({ ...options(), input: 9 })])).toEqual([
      [4],
      [9],
    ]);
    expect(contexts[0]?.workflowRunId).not.toBe(contexts[1]?.workflowRunId);
    expect(contexts.map((c) => c.state.values)).toEqual([[4], [9]]);
    expect(Reflect.set(contexts[0]!, 'signal', new AbortController().signal)).toBe(false);
  });

  it('preserves execution, error-hook and cleanup failures in order, including undefined throws', async () => {
    const primary = new Error('work');
    const handler = new Error('handler');
    const cleanup = new Error('cleanup');
    const order: string[] = [];
    const flow = workflow(
      () => {
        throw primary;
      },
      {
        lifecycle: {
          onError: (_c, error) => {
            expect(error).toBe(primary);
            order.push('error');
            throw handler;
          },
          onFinally: () => {
            order.push('finally');
            throw cleanup;
          },
        },
      }
    );
    await expect(flow.run(options())).rejects.toSatisfy((error: unknown) => {
      expect(leaves(error)).toEqual([primary, handler, cleanup]);
      return true;
    });
    expect(order).toEqual(['error', 'finally']);
    await expect(
      workflow(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- foreign callbacks may throw any value
        throw undefined;
      }).run(options())
    ).rejects.toBeUndefined();
  });

  it('calls onError after onSuccess fails and disallows new work from hooks', async () => {
    const failure = new Error('success-hook');
    const observed = vi.fn();
    const flow = workflow((c) => c.runStep('a'), {
      lifecycle: {
        onSuccess: () => {
          throw failure;
        },
        onError: observed,
        onFinally: async (c) => {
          await expect(c.runStep('b')).rejects.toMatchObject({ code: 'WORKFLOW_SCOPE_CLOSED' });
        },
      },
    });
    await expect(flow.run(options())).rejects.toBe(failure);
    expect(observed).toHaveBeenCalledWith(expect.anything(), failure);
  });

  it('has no hooks before context construction and never converts failure into a default result', async () => {
    const hook = vi.fn();
    const error = new Error('factory');
    await expect(
      workflow(() => Promise.resolve(), {
        createState: () => {
          throw error;
        },
        lifecycle: { onFinally: hook },
      }).run(options())
    ).rejects.toBe(error);
    expect(hook).not.toHaveBeenCalled();
    await expect(
      workflow(() => {
        throw error;
      }).run(options())
    ).rejects.toBe(error);
  });

  it('emits metadata-only ordered events; throwing, rejected and stalled observers do not affect work', async () => {
    const events: WorkflowEvent[] = [];
    const flow = workflow((c) => c.runStep('a'));
    const result = await flow.run({
      ...options(),
      parentRunId: 'caller',
      onEvent: (event) => {
        events.push(event);
        expect(Object.isFrozen(event)).toBe(true);
        if (event.type === 'step-started') throw new Error('observer');
        if (event.type === 'step-completed') return Promise.reject(new Error('observer'));
        return new Promise<void>(() => undefined);
      },
    });
    expect(result).toEqual([4]);
    expect(events.map((e) => e.type)).toEqual([
      'workflow-started',
      'step-started',
      'step-started',
      'step-completed',
      'step-completed',
      'workflow-completed',
    ]);
    expect(events.every((e) => e.parentRunId === 'caller')).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/borrowed|resources|result|input|state/);
  });

  it('checks cancellation at admission and after a waiting condition, not after a successful commit', async () => {
    const parent = new AbortController();
    const condition = gate();
    const entered = gate();
    const work = vi.fn();
    const flow = workflow(work, {
      condition: async () => {
        entered.resolve();
        await condition.promise;
        return skipWorkflow('skip');
      },
    });
    const result = flow.run({ ...options(), signal: parent.signal });
    await entered.promise;
    parent.abort();
    condition.resolve();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(work).not.toHaveBeenCalled();
    await expect(flow.run({ ...options(), signal: parent.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    const committed = new AbortController();
    expect(
      await workflow((c) => {
        c.state.values = [1];
        committed.abort();
        return Promise.resolve();
      }).run({ ...options(), signal: committed.signal })
    ).toEqual([1]);
  });

  it('validates name and entry policies at construction', () => {
    expect(() => workflow(() => Promise.resolve(), { name: ' ' })).toThrowError(
      'Workflow name is required.'
    );
    expect(() =>
      workflow(() => Promise.resolve(), {
        stepDefinitions: {
          main: once(() => Promise.resolve(), true),
          a: once(() => Promise.resolve()),
          b: once(() => Promise.resolve()),
          c: once(() => Promise.resolve()),
        },
        stepOverrides: { main: SKIP_STEP },
      })
    ).toThrowError('Entry Step cannot be skipped.');
  });
});
