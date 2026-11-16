import { expect, it, vi } from 'vitest';
import { Workflow } from '@print-an-agent/workflow-core';

it('cannot hide a late executor protocol violation inside a success hook', async () => {
  let retained: (() => Promise<void>) | undefined;
  const errorHook = vi.fn();
  const cleanup = vi.fn();
  const createResult = vi.fn(() => 0);
  const flow = new Workflow<'main', void, void, void, number>({
    name: 'late-protocol',
    resources: undefined,
    entryStep: 'main',
    createState: () => undefined,
    createResult,
    stepDefinitions: {
      main: {
        step: () => Promise.resolve(),
        skippable: false,
        cardinality: 'at-most-once',
      },
    },
    executeStep: async ({ step, context }) => {
      retained = () => step(context);
      await step(context);
    },
    lifecycle: {
      onSuccess: async () => {
        await retained?.().catch(() => undefined);
      },
      onError: errorHook,
      onFinally: cleanup,
    },
  });
  await expect(flow.run({ input: undefined })).rejects.toMatchObject({
    code: 'STEP_EXECUTOR_INVALID',
  });
  expect(createResult).not.toHaveBeenCalled();
  expect(errorHook).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
