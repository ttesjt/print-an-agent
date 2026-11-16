import { expect, it, vi } from 'vitest';
import { WorkflowRunError, type WorkflowEvent } from '@print-an-agent/workflow-core';
import { aborted, gate, options, workflow } from '../support/fixtures.js';

it.each(['condition', 'createState'] as const)(
  'classifies %s failure without creating a Step or running context hooks',
  async (phase) => {
    const failure = new Error(phase);
    const events: WorkflowEvent[] = [];
    const hook = vi.fn();
    const classifyFailure = vi.fn(() => 'PREPARATION_FAILED');
    const flow = workflow(() => Promise.resolve(), {
      [phase]: () => {
        throw failure;
      },
      lifecycle: { onFinally: hook },
    });
    await expect(
      flow.run({
        ...options(),
        classifyFailure,
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).rejects.toBe(failure);
    expect(events.map((event) => event.type)).toEqual(['workflow-started', 'workflow-failed']);
    expect(events.at(-1)).toMatchObject({ errorCode: 'PREPARATION_FAILED' });
    expect(classifyFailure).toHaveBeenCalledExactlyOnceWith(failure);
    expect(hook).not.toHaveBeenCalled();
  }
);

it.each(['onSuccess', 'createResult', 'onFinally'] as const)(
  'classifies %s failure without claiming a completed Step failed',
  async (phase) => {
    const failure = new Error(phase);
    const events: WorkflowEvent[] = [];
    await expect(
      workflow(() => Promise.resolve(), {
        ...(phase === 'createResult'
          ? {
              createResult: () => {
                throw failure;
              },
            }
          : {
              lifecycle: {
                [phase]: () => {
                  throw failure;
                },
              },
            }),
      }).run({
        ...options(),
        classifyFailure: () => 'HOOK_FAILED',
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).rejects.toBe(failure);
    expect(events.filter((event) => event.type.endsWith('failed'))).toEqual([
      expect.objectContaining({ type: 'workflow-failed', errorCode: 'HOOK_FAILED' }),
    ]);
  }
);

it('classifies framework executor failures at their actual Step and Workflow boundaries', async () => {
  const events: WorkflowEvent[] = [];
  const flow = workflow(() => Promise.resolve(), { executeStep: () => Promise.resolve() });
  await expect(
    flow.run({
      ...options(),
      classifyFailure: (error) => (error instanceof WorkflowRunError ? error.code : undefined),
      onEvent: (event) => {
        events.push(event);
      },
    })
  ).rejects.toMatchObject({ code: 'STEP_EXECUTOR_INVALID' });
  expect(events.filter((event) => event.type.endsWith('failed'))).toEqual([
    expect.objectContaining({ type: 'step-failed', errorCode: 'STEP_EXECUTOR_INVALID' }),
    expect.objectContaining({ type: 'workflow-failed', errorCode: 'STEP_EXECUTOR_INVALID' }),
  ]);
});

it('preserves cancellation and waits for resource cleanup despite classification failure', async () => {
  const started = gate();
  const cleaning = gate();
  const release = gate();
  const parent = new AbortController();
  const cancellation = new Error('cancel');
  const events: WorkflowEvent[] = [];
  const settled = vi.fn();
  const flow = workflow(
    async (context) => {
      started.resolve();
      await aborted(context.signal);
      context.signal.throwIfAborted();
    },
    {
      lifecycle: {
        onFinally: async () => {
          cleaning.resolve();
          await release.promise;
        },
      },
    }
  );
  const result = flow.run({
    ...options(),
    signal: parent.signal,
    classifyFailure: () => {
      throw new Error('classifier failure');
    },
    onEvent: (event) => {
      events.push(event);
      throw new Error('observer failure');
    },
  });
  const checked = expect(result).rejects.toBe(cancellation).then(settled);
  await started.promise;
  parent.abort(cancellation);
  await cleaning.promise;
  expect(settled).not.toHaveBeenCalled();
  expect(events.at(-1)?.type).toBe('step-failed');
  release.resolve();
  await checked;
  expect(events.at(-1)?.type).toBe('workflow-failed');
  expect(events.every((event) => !Object.hasOwn(event, 'errorCode'))).toBe(true);
});
