import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { skipWorkflow, STEP_CARDINALITY, Workflow } from '@print-an-agent/workflow-core';

const definition = {
  name: 'result-factories',
  resources: undefined,
  entryStep: 'main',
  createState: () => undefined,
  stepDefinitions: {
    main: {
      step: () => Promise.resolve(),
      skippable: false,
      cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
    },
  },
} as const;

it('reports an async projection as failure and retains an independent cleanup error', async () => {
  const cleanup = new Error('cleanup');
  const onError = vi.fn();
  const events: string[] = [];
  const flow = new Workflow({
    ...definition,
    async createResult() {
      await Promise.resolve();
      throw new Error('factory rejection');
    },
    lifecycle: {
      onError,
      async onFinally() {
        await new Promise<void>((resolve) => setImmediate(resolve));
        throw cleanup;
      },
    },
  });

  await expect(
    flow.run({
      input: undefined,
      onEvent(event) {
        events.push(event.type);
      },
    })
  ).rejects.toMatchObject({
    errors: [{ code: 'WORKFLOW_RESULT_ASYNC', subjectName: 'createResult' }, cleanup],
  });
  expect(onError).toHaveBeenCalledExactlyOnceWith(
    expect.anything(),
    expect.objectContaining({ code: 'WORKFLOW_RESULT_ASYNC', subjectName: 'createResult' })
  );
  expect(events).toEqual(['workflow-started', 'step-started', 'step-completed', 'workflow-failed']);
});

it('reports a skip projection returning a rejected Promise from another realm as failure', async () => {
  const events: string[] = [];
  const onFinally = vi.fn();
  const flow = new Workflow({
    ...definition,
    createResult: () => 1,
    condition: () => skipWorkflow('not needed'),
    createSkippedResult: (): unknown =>
      runInNewContext('Promise.reject(new Error("skip rejection"))'),
    lifecycle: { onFinally },
  });

  await expect(
    flow.run({
      input: undefined,
      onEvent(event) {
        events.push(event.type);
      },
    })
  ).rejects.toMatchObject({ code: 'WORKFLOW_RESULT_ASYNC', subjectName: 'createSkippedResult' });
  expect(events).toEqual(['workflow-started', 'workflow-failed']);
  expect(onFinally).not.toHaveBeenCalled();
  // Give Node a turn to report an unhandled rejection if the Promise was left unobserved.
  await new Promise<void>((resolve) => setImmediate(resolve));
});

it.each(['createResult', 'createSkippedResult'] as const)(
  'rejects custom thenables from %s without calling then',
  async (factory) => {
    const then = vi.fn((resolve: (value: number) => void) => resolve(1));
    const thenable =
      factory === 'createResult' ? { then } : Object.assign(() => undefined, { then });
    const flow = new Workflow({
      ...definition,
      createResult: (): number | typeof thenable => (factory === 'createResult' ? thenable : 1),
      condition: () =>
        factory === 'createSkippedResult' ? skipWorkflow('not needed') : { status: 'run' },
      createSkippedResult: () => thenable,
    });

    await expect(flow.run({ input: undefined })).rejects.toMatchObject({
      code: 'WORKFLOW_RESULT_ASYNC',
      subjectName: factory,
    });
    expect(then).not.toHaveBeenCalled();
  }
);

it('supports callable state and preserves data with a non-callable then property', async () => {
  const flow = new Workflow({
    ...definition,
    createState:
      ({ input }: { input: number }) =>
      () =>
        input * 2,
    createResult: (state) => ({ then: 'field', total: state() }),
  });

  await expect(flow.run({ input: 3 })).resolves.toEqual({ then: 'field', total: 6 });
});
