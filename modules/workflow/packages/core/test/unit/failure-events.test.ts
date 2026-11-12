import { expect, it, vi } from 'vitest';
import { type WorkflowEvent } from '@print-an-agent/workflow-core';
import { gate, options, workflow } from '../support/fixtures.js';

it('classifies a recovered child failure without changing the successful parent result', async () => {
  const original = new Error('private message', { cause: { credential: 'private-token' } });
  const events: WorkflowEvent[] = [];
  const classifyFailure = vi.fn((error: unknown) =>
    error === original ? 'RECORD_CONFLICT' : undefined
  );
  const flow = workflow(
    async (context) => {
      try {
        await context.runStep('a');
      } catch {
        context.result = [7];
      }
    },
    {
      createRunId: () => 'workflow-1',
      stepOverrides: {
        a: () => {
          throw original;
        },
      },
    }
  );
  const run = {
    ...options(),
    parentRunId: 'host-run',
    classifyFailure,
    onEvent: (event: WorkflowEvent) => {
      events.push(event);
    },
  };

  await expect(flow.run(run)).resolves.toEqual([7]);
  expect(classifyFailure).toHaveBeenCalledExactlyOnceWith(original);
  expect(events.filter((event) => event.type === 'step-failed')).toEqual([
    {
      type: 'step-failed',
      workflowName: 'test',
      workflowRunId: 'workflow-1',
      parentRunId: 'host-run',
      stepName: 'a',
      invocationId: 'workflow-1:2',
      errorCode: 'RECORD_CONFLICT',
    },
  ]);
  expect(events.map((event) => event.type)).toEqual([
    'workflow-started',
    'step-started',
    'step-started',
    'step-failed',
    'step-completed',
    'workflow-completed',
  ]);
  expect(events.every(Object.isFrozen)).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/private|message|stack|cause|credential/);
  expect(
    events
      .filter((event) => event.type !== 'step-failed')
      .every((event) => !Object.hasOwn(event, 'errorCode'))
  ).toBe(true);
});

it('classifies the actual failure at each boundary, retaining the original thrown aggregate', async () => {
  const primary = new Error('work');
  const cleanup = new Error('cleanup');
  const events: WorkflowEvent[] = [];
  const failures: unknown[] = [];
  const flow = workflow(
    () => {
      throw primary;
    },
    {
      lifecycle: {
        onFinally: () => {
          throw cleanup;
        },
      },
    }
  );
  const run = {
    ...options(),
    classifyFailure: (error: unknown) => {
      failures.push(error);
      return error instanceof AggregateError ? 'CLEANUP_FAILED' : 'WORK_FAILED';
    },
    onEvent: (event: WorkflowEvent) => {
      events.push(event);
    },
  };
  const outcome: unknown = await flow.run(run).catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(AggregateError);
  expect(outcome).toMatchObject({ errors: [primary, cleanup], cause: primary });
  expect(failures).toEqual([primary, outcome]);
  expect(events.filter((event) => event.type.endsWith('failed'))).toEqual([
    expect.objectContaining({ type: 'step-failed', errorCode: 'WORK_FAILED' }),
    expect.objectContaining({ type: 'workflow-failed', errorCode: 'CLEANUP_FAILED' }),
  ]);
});

it('keeps classifiers and observers local to concurrent runs of the same definition', async () => {
  const both = gate();
  let entered = 0;
  const failure = new Error('shared');
  const flow = workflow(async () => {
    if (++entered === 2) both.resolve();
    await both.promise;
    throw failure;
  });
  const events = [[], []] as [WorkflowEvent[], WorkflowEvent[]];
  await Promise.all(
    events.map(async (target, index) => {
      const run = {
        ...options(),
        classifyFailure: () => `HOST_${index}`,
        onEvent: (event: WorkflowEvent) => {
          target.push(event);
        },
      };
      await expect(flow.run(run)).rejects.toBe(failure);
      expect(target.filter((event) => event.type.endsWith('failed'))).toEqual([
        expect.objectContaining({ errorCode: `HOST_${index}` }),
        expect.objectContaining({ errorCode: `HOST_${index}` }),
      ]);
    })
  );
  expect(events[0][0]?.workflowRunId).not.toBe(events[1][0]?.workflowRunId);
});

it('passes a legitimate undefined failure to the classifier without substituting an error', async () => {
  const classifyFailure = vi.fn(() => 'FOREIGN_FAILURE');
  await expect(
    workflow(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- foreign callbacks may throw any value
      throw undefined;
    }).run({
      ...options(),
      classifyFailure,
      onEvent: () => undefined,
    })
  ).rejects.toBeUndefined();
  expect(classifyFailure.mock.calls).toEqual([[undefined], [undefined]]);
});
