import { expect, it, vi } from 'vitest';
import { Workflow, type WorkflowInputs } from '@print-an-agent/workflow-core';
import { aborted, gate, options, workflow, type Context } from '../../support/fixtures.js';

it('captures the resource binding at assembly and uses it in admission, state creation, Steps, executor and hooks', async () => {
  class Store {
    readonly values: number[] = [];
    save(value: number): Promise<void> {
      this.values.push(value);
      return Promise.resolve();
    }
    close = vi.fn();
  }
  const store = new Store();
  const replacement = new Store();
  const seen: Store[] = [];
  const definition = {
    name: 'bound-store',
    resources: store,
    entryStep: 'save' as const,
    createResult: ({ count }: { count: number }) => count,
    createState: ({ input, resources }: WorkflowInputs<number, Store>) => {
      seen.push(resources);
      return { input, count: 0 };
    },
  };
  const flow = new Workflow<'save', number, { input: number; count: number }, Store, number>({
    ...definition,
    condition: ({ resources }) => {
      seen.push(resources);
      return { status: 'run' };
    },
    stepDefinitions: {
      save: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (c) => {
          seen.push(c.resources);
          await c.resources.save(c.state.input);
          c.state.count = c.resources.values.length;
          expect(Reflect.set(c, 'resources', replacement)).toBe(false);
        },
      },
    },
    executeStep: async ({ step, context }) => {
      seen.push(context.resources);
      await step(context);
    },
    lifecycle: {
      onSuccess: (c) => {
        seen.push(c.resources);
      },
      onFinally: (c) => {
        seen.push(c.resources);
      },
    },
  });
  expect(seen).toEqual([]);
  expect(store.values).toEqual([]);

  // An untyped caller cannot use extra execution fields to rebind dependencies.
  const runOptions = {
    input: 3,
    get resources(): Store {
      throw new Error('Execution must not read a resources override.');
    },
  };
  expect(await flow.run(runOptions)).toBe(1);
  expect(await flow.run({ input: 7 })).toBe(2);
  expect(seen).toHaveLength(12);
  expect(seen.every((resources) => resources === store)).toBe(true);
  expect(store.values).toEqual([3, 7]);
  expect(replacement.values).toEqual([]);
  expect(store.close).not.toHaveBeenCalled();
  expect(Object.isFrozen(store)).toBe(false);
});

it('retains the original resource instance when the caller later replaces the definition field', async () => {
  const original = { label: 'original' };
  const definition = {
    name: 'captured-binding',
    resources: original,
    entryStep: 'main' as const,
    createResult: ({ label }: { label: string }) => label,
    createState: () => ({ label: '' }),
    stepDefinitions: {
      main: {
        skippable: false,
        cardinality: 'at-most-once' as const,
        step: (c: { readonly resources: typeof original; state: { label: string } }) => {
          c.state.label = c.resources.label;
          return Promise.resolve();
        },
      },
    },
  };
  const flow = new Workflow<'main', void, { label: string }, typeof original, string>(definition);
  definition.resources = { label: 'replacement' };
  original.label = 'original-updated';
  expect(await flow.run({ input: undefined })).toBe('original-updated');
});

it('shares bound capabilities across parallel runs while isolating cancellation and local execution', async () => {
  const started = gate();
  const release = gate();
  const parent = new AbortController();
  const shared = { label: 'shared' };
  const contexts: Context[] = [];
  const hook = vi.fn();
  const flow = workflow(
    async (c) => {
      contexts.push(c);
      if (contexts.length === 2) started.resolve();
      if (c.state.input === 4) {
        await aborted(c.signal);
        c.signal.throwIfAborted();
      } else {
        await release.promise;
      }
      await c.runStep('a');
    },
    {
      resources: shared,
      lifecycle: { onFinally: hook },
    }
  );
  const cancelled = flow
    .run({ ...options(), signal: parent.signal })
    .catch((error: unknown) => error);
  const completed = flow.run({ input: 9 });
  try {
    await started.promise;
    parent.abort();
    expect(await cancelled).toBe(parent.signal.reason);
    expect(contexts.every((c) => c.resources === shared)).toBe(true);
    expect(contexts[1]?.signal.aborted).toBe(false);
  } finally {
    parent.abort();
    release.resolve();
  }
  expect(await completed).toEqual([9]);
  expect(contexts.map((c) => c.state.values)).toEqual([[], [9]]);
  expect(contexts[0]?.state).not.toBe(contexts[1]?.state);
  expect(contexts[0]?.workflowRunId).not.toBe(contexts[1]?.workflowRunId);
  expect(hook).toHaveBeenCalledTimes(2);
  await expect(flow.run({ input: 9 })).resolves.toEqual([9]);
});
