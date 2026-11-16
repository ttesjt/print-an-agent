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
} from '../support/fixtures.js';

describe('Workflow data and lifecycle', () => {
  it('exposes transformed state to Steps, executors and hooks without a raw input field', async () => {
    const views: object[] = [];
    const flow = new Workflow<'main' | 'child', { message: string }, number, undefined, number>({
      name: 'message-length',
      resources: undefined,
      entryStep: 'main',
      createState: ({ input }) => input.message.length,
      createResult: () => 0,
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
            context.result = context.state;
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
    await expect(flow.run({ input: { message: 'hello' } })).resolves.toBe(5);
    expect(views).toHaveLength(6);
    expect(views.every((context) => !('input' in context))).toBe(true);
  });

  it('resolves leaf overrides inside a composite and permits full entry replacement', async () => {
    const main = createSequentialStep<Names, Context>(['a', 'b']);
    const flow = workflow(main, {
      stepOverrides: {
        a: (c) => {
          c.result = [12];
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
            c.result = [21];
            return Promise.resolve();
          },
        },
      }).run(options())
    ).toEqual([21]);
  });

  it('initializes results before condition, skips state/hooks, and returns a fresh legal default', async () => {
    const order: string[] = [];
    const state = vi.fn(({ input }: { input: number }) => ({ input, values: [] }));
    const hook = vi.fn();
    const flow = workflow(() => Promise.resolve(), {
      createResult: () => {
        order.push('result');
        return [];
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
    expect(a).toEqual([]);
    expect(a).not.toBe(b);
    expect(order).toEqual(['result', 'condition', 'result', 'condition']);
    expect(state).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
  });

  it('allows primitive replacement and a legitimate undefined result', async () => {
    const scalar = new Workflow<'main', number, number, void, number>({
      name: 'scalar',
      resources: undefined,
      entryStep: 'main',
      createState: ({ input }) => input * 2,
      createResult: () => 0,
      stepDefinitions: {
        main: {
          step: (c) => {
            c.result = c.state;
            return Promise.resolve();
          },
          skippable: false,
          cardinality: 'at-most-once',
        },
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

  it('isolates simultaneous runs and freezes execution fields without freezing business data', async () => {
    const ready = gate();
    let count = 0;
    const contexts: Context[] = [];
    const flow = workflow(async (c) => {
      contexts.push(c);
      c.state.values.push(c.state.input);
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
        c.result = [1];
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
