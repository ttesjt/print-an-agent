import { expect, it } from 'vitest';
import {
  Workflow,
  type Step,
  type WorkflowContext,
  type StepExecutor,
} from '@print-an-agent/workflow-core';
import { gate, onAbort, causes } from './support/execution.js';

type Context = WorkflowContext<'main' | 'child', void, void, number>;
function fixture(step: Step<Context>, executor: StepExecutor<'main' | 'child', Context>) {
  return new Workflow<'main' | 'child', void, void, void, number>({
    name: 'executor',
    resources: undefined,
    entryStep: 'main',
    createState: () => undefined,
    createResult: () => 0,
    stepDefinitions: {
      main: { step, cardinality: 'at-most-once', skippable: false },
      child: {
        step: (c) => {
          c.result++;
          return Promise.resolve();
        },
        cardinality: 'repeatable',
        skippable: false,
      },
    },
    executeStep: executor,
  });
}
const options = { input: undefined };

it('locks executor concurrent attempt violations even when the executor handles them', async () => {
  const started = gate();
  let attempts = 0;
  const flow = fixture(
    async (c) => {
      attempts++;
      started.resolve();
      await onAbort(c.signal);
    },
    async ({ step, context }) => {
      const first = step(context);
      await started.promise;
      await step(context).catch(() => undefined);
      await first;
    }
  );
  await expect(flow.run(options)).rejects.toMatchObject({ code: 'STEP_EXECUTOR_INVALID' });
  expect(attempts).toBe(1);
});

it('rejects a replacement context before executing the implementation', async () => {
  let started = false;
  const flow = fixture(
    () => {
      started = true;
      return Promise.resolve();
    },
    async ({ step, context }) => {
      await step({ ...context });
    }
  );
  await expect(flow.run(options)).rejects.toMatchObject({ code: 'STEP_EXECUTOR_INVALID' });
  expect(started).toBe(false);
});

it('does not admit retained executor callables after run completion', async () => {
  let call: (() => Promise<void>) | undefined;
  let count = 0;
  const flow = fixture(
    () => {
      count++;
      return Promise.resolve();
    },
    async ({ step, context }) => {
      call = () => step(context);
      await step(context);
    }
  );
  await flow.run(options);
  await expect(call?.()).rejects.toMatchObject({ code: 'STEP_EXECUTOR_INVALID' });
  expect(count).toBe(1);
});

it('closes the preceding attempt context before an explicit retry begins', async () => {
  let old: Context | undefined;
  let attempts = 0;
  const flow = fixture(
    async (c) => {
      if (++attempts === 1) {
        old = c;
        throw new Error('retry me');
      }
      if (old === undefined) throw new Error('first attempt missing');
      await expect(old.runStep('child')).rejects.toMatchObject({ code: 'WORKFLOW_SCOPE_CLOSED' });
      await c.runStep('child');
    },
    async ({ stepName, step, context }) => {
      try {
        await step(context);
      } catch (error) {
        if (stepName !== 'main') throw error;
        await step(context);
      }
    }
  );
  expect(await flow.run(options)).toBe(1);
  expect(attempts).toBe(2);
});

it('preserves executor failure and a pending attempt cleanup failure after cancellation', async () => {
  const started = gate();
  const release = gate();
  const observed = gate();
  const outer = new Error('executor');
  const cleanup = new Error('implementation cleanup');
  const flow = fixture(
    async (c) => {
      started.resolve();
      await onAbort(c.signal);
      observed.resolve();
      await release.promise;
      throw cleanup;
    },
    async ({ step, context }) => {
      void step(context);
      await started.promise;
      throw outer;
    }
  );
  const outcome = flow.run(options).catch((error: unknown) => error);
  await observed.promise;
  release.resolve();
  expect(causes(await outcome)).toEqual([outer, cleanup]);
});
