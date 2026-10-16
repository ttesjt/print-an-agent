import { skipWorkflow, type WorkflowEvent } from '@ta-agent/workflow-core';
import { WorkflowBundle } from '@ta-agent/workflow-bundle';
import { expect, it, vi } from 'vitest';
import { readDefinition, type ReadContext } from '../support/definitions.js';

it('preserves condition skipping and the initial result without creating state or closing resources', async () => {
  const resources = { read: vi.fn(() => Promise.resolve('value')), close: vi.fn() };
  const createState = vi.fn(() => undefined);
  const onFinally = vi.fn();
  const seen: ReadContext['resources'][] = [];
  const inspect: ReturnType<typeof readDefinition> = {
    ...readDefinition(),
    createResult: ({ resources: binding }) => {
      seen.push(binding);
      return 'not needed';
    },
    createState,
    condition: ({ resources: binding }) => {
      seen.push(binding);
      return skipWorkflow('already handled');
    },
    lifecycle: { onFinally },
  };
  const bundle = new WorkflowBundle({ resources, workflows: { inspect } });
  expect(seen).toEqual([]);
  const events: WorkflowEvent[] = [];
  await expect(
    bundle.workflows.inspect.run({
      input: { id: 'one' },
      onEvent: (event) => {
        events.push(event);
      },
    })
  ).resolves.toBe('not needed');
  expect(seen).toEqual([resources, resources]);
  expect(events.at(-1)).toMatchObject({ type: 'workflow-skipped', reason: 'already handled' });
  expect(createState).not.toHaveBeenCalled();
  expect(resources.read).not.toHaveBeenCalled();
  expect(onFinally).not.toHaveBeenCalled();
  expect(resources.close).not.toHaveBeenCalled();
});

it('preserves member executors, hooks, Run identity and parent observation without a Bundle Run', async () => {
  const resources = { read: () => Promise.resolve('value') };
  const seen: ReadContext['resources'][] = [];
  const inspect: ReturnType<typeof readDefinition> = {
    ...readDefinition(),
    createRunId: () => 'custom-run',
    executeStep: async ({ context, step }) => {
      seen.push(context.resources);
      await step(context);
    },
    lifecycle: {
      onSuccess: (context) => {
        context.result += ' checked';
      },
      onFinally: (context) => {
        seen.push(context.resources);
      },
    },
  };
  const bundle = new WorkflowBundle({ resources, workflows: { inspect } });
  const events: WorkflowEvent[] = [];
  await expect(
    bundle.workflows.inspect.run({
      input: { id: 'one' },
      parentRunId: 'caller',
      onEvent: (event) => {
        events.push(event);
      },
    })
  ).resolves.toBe('value checked');
  expect(seen).toEqual([resources, resources, resources]);
  expect(
    events.every(
      (event) =>
        event.workflowRunId === 'custom-run' &&
        event.workflowName === 'records.inspect' &&
        event.parentRunId === 'caller'
    )
  ).toBe(true);
  expect(events.filter((event) => event.type === 'workflow-started')).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('workflow-completed');
});

it('preserves factory failures and failure classification while leaving borrowed resources usable', async () => {
  const failure = new Error('state failed');
  const resources = { read: () => Promise.resolve('still usable'), close: vi.fn() };
  const onFinally = vi.fn();
  const inspect: ReturnType<typeof readDefinition> = {
    ...readDefinition(),
    createState: () => {
      throw failure;
    },
    lifecycle: { onFinally },
  };
  const bundle = new WorkflowBundle({
    resources,
    workflows: { inspect, healthy: readDefinition() },
  });
  const events: WorkflowEvent[] = [];
  await expect(
    bundle.workflows.inspect.run({
      input: { id: 'one' },
      classifyFailure: (error) => (error === failure ? 'STATE_FAILED' : undefined),
      onEvent: (event) => {
        events.push(event);
      },
    })
  ).rejects.toBe(failure);
  expect(events.at(-1)).toMatchObject({ type: 'workflow-failed', errorCode: 'STATE_FAILED' });
  await expect(bundle.workflows.healthy.run({ input: { id: 'one' } })).resolves.toBe(
    'still usable'
  );
  expect(onFinally).not.toHaveBeenCalled();
  expect(resources.close).not.toHaveBeenCalled();
});
