import type { WorkflowContext, WorkflowEvent } from '@print-an-agent/workflow-core';
import { WorkflowBundle, type BundleWorkflowDefinition } from '@print-an-agent/workflow-bundle';
import { expect, it, vi } from 'vitest';
import { readDefinition, writeDefinition, type ReadContext } from '../support/definitions.js';

it('isolates state, result, counts, Run identities and observers across repeated and distinct members', async () => {
  type Context = WorkflowContext<'main', { input: number; values: number[] }, { label: string }>;
  type Definition = BundleWorkflowDefinition<
    'main',
    number,
    Context['state'],
    Context['resources'],
    number[]
  >;
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const contexts: Context[] = [];
  const createState = vi.fn(({ input }: { input: number }): Context['state'] => ({
    input,
    values: [],
  }));
  const definition: Definition = {
    name: 'first',
    entryStep: 'main',
    createState,
    createResult: ({ values }) => [...values],
    stepDefinitions: {
      main: {
        cardinality: 'at-most-once',
        skippable: false,
        step: async (c) => {
          contexts.push(c);
          if (contexts.length === 3) ready.resolve();
          await release.promise;
          c.state.values.push(c.state.input);
        },
      },
    },
  };
  const resources = { label: 'borrowed' };
  const bundle = new WorkflowBundle({
    resources,
    workflows: { first: definition, second: { ...definition, name: 'second' } },
  });
  expect(createState).not.toHaveBeenCalled();
  const events: WorkflowEvent[][] = [[], [], []];
  const runs = [bundle.workflows.first, bundle.workflows.first, bundle.workflows.second].map(
    (flow, index) =>
      flow.run({
        input: index,
        parentRunId: `caller-${index}`,
        onEvent: (event) => {
          events[index]?.push(event);
        },
      })
  );
  try {
    await ready.promise;
    expect(contexts.every((context) => context.resources === resources)).toBe(true);
  } finally {
    release.resolve();
    await Promise.allSettled(runs);
  }
  const results = await Promise.all(runs);
  expect(results).toEqual([[0], [1], [2]]);
  expect(new Set(contexts.map((c) => c.state)).size).toBe(3);
  expect(new Set(results).size).toBe(3);
  expect(new Set(contexts.map((c) => c.workflowRunId)).size).toBe(3);
  expect(contexts.map((c) => c.state.values)).toEqual([[0], [1], [2]]);
  for (const [index, records] of events.entries()) {
    expect(records.every((event) => event.parentRunId === `caller-${index}`)).toBe(true);
    expect(records.filter((event) => event.type === 'workflow-started')).toHaveLength(1);
    expect(records.filter((event) => event.type === 'workflow-completed')).toHaveLength(1);
  }
});

it('cancels and drains only the selected call and leaves a sibling member and borrowed resources usable', async () => {
  const started = Promise.withResolvers<void>();
  const exiting = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const parent = new AbortController();
  const close = vi.fn();
  const finalized = vi.fn();
  const failure = new Error('cancel selected call');
  let cancelledContext: ReadContext | undefined;
  const inspect = {
    ...readDefinition(async (context) => {
      cancelledContext = context;
      started.resolve();
      await new Promise<void>((resolve) =>
        context.signal.addEventListener('abort', () => resolve(), { once: true })
      );
      exiting.resolve();
      await release.promise;
      context.signal.throwIfAborted();
    }),
    lifecycle: { onFinally: finalized },
  };
  const resources = {
    read: () => Promise.resolve('still usable'),
    write: () => Promise.resolve(),
    close,
  };
  const bundle = new WorkflowBundle({
    resources,
    workflows: { inspect, update: writeDefinition() },
  });
  const run = bundle.workflows.inspect
    .run({ input: { id: 'one' }, signal: parent.signal })
    .catch((error: unknown) => error);
  try {
    await started.promise;
    parent.abort(failure);
    await exiting.promise;
    expect(finalized).not.toHaveBeenCalled();
    await expect(bundle.workflows.update.run({ input: { id: 'two', value: 'OK' } })).resolves.toBe(
      2
    );
    expect(cancelledContext?.resources).toBe(resources);
    expect(close).not.toHaveBeenCalled();
  } finally {
    parent.abort();
    release.resolve();
    await run;
  }
  expect(await run).toBe(failure);
  expect(finalized).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
});
