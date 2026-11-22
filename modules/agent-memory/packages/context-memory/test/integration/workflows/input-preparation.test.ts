import { expect, it, vi } from 'vitest';
import { Workflow } from '@print-an-agent/workflow-core';
import {
  createContextMemoryBundle,
  createMemoryGetReceiptDefinition,
  createMemoryObserveDefinition,
  createModelMemoryResources,
  MemoryMeter,
} from '@print-an-agent/context-memory';
import type { MemoryOperations, ModelMemoryResources } from '@print-an-agent/context-memory';
import { testCounter } from '../../support/counter.js';
import { TestMemoryStore } from '../../support/store.js';

const request = { memoryId: 'notes', requestId: 'review' };

function modelResources(): ModelMemoryResources {
  return createModelMemoryResources({
    store: new TestMemoryStore(),
    meter: new MemoryMeter({ counter: testCounter('chars') }),
    defaults: { measurementRef: 'chars' },
    planner: { plan: () => Promise.resolve([]) },
  });
}

it('does not call the deterministic capability if an override leaves input unprepared', async () => {
  const getReceipt = vi.fn<MemoryOperations['getReceipt']>(() => Promise.resolve(undefined));
  const workflow = new Workflow({
    ...createMemoryGetReceiptDefinition({
      stepOverrides: { prepareInput: () => Promise.resolve() },
    }),
    resources: { memory: { getReceipt } },
  });

  await expect(workflow.run({ input: request })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  expect(getReceipt).not.toHaveBeenCalled();
});

it('does not begin a model update if an override leaves input unprepared', async () => {
  const defaults = modelResources();
  const begin = vi.fn<ModelMemoryResources['updates']['begin']>(() =>
    Promise.reject(new Error('Unexpected model update'))
  );
  const workflow = new Workflow({
    ...createMemoryObserveDefinition({ stepOverrides: { prepareInput: () => Promise.resolve() } }),
    resources: { ...defaults, updates: { ...defaults.updates, begin } },
  });

  await expect(workflow.run({ input: { ...request, context: [] } })).rejects.toMatchObject({
    code: 'INPUT_INVALID',
    commit: { status: 'not-committed' },
  });
  expect(begin).not.toHaveBeenCalled();
});

it('passes a detached input through a wrapped default prepare Step', async () => {
  const getReceipt = vi.fn<MemoryOperations['getReceipt']>(() => Promise.resolve(undefined));
  const prepare = createMemoryGetReceiptDefinition().stepDefinitions.prepareInput.step;
  if (prepare === undefined) throw new Error('Missing default input preparation Step');
  const wrappedPrepare = vi.fn(prepare);
  const workflow = new Workflow({
    ...createMemoryGetReceiptDefinition({ stepOverrides: { prepareInput: wrappedPrepare } }),
    resources: { memory: { getReceipt } },
  });

  await expect(workflow.run({ input: request })).resolves.toBeUndefined();
  expect(wrappedPrepare).toHaveBeenCalledOnce();
  expect(getReceipt).toHaveBeenCalledOnce();
  const received = getReceipt.mock.calls[0]?.[0];
  expect(received).toEqual(request);
  expect(received).not.toBe(request);
});

it('allows a custom Step to prepare a detached model input without replacing it', async () => {
  const defaults = modelResources();
  const begin = vi.fn(defaults.updates.begin.bind(defaults.updates));
  const resources = { ...defaults, updates: { ...defaults.updates, begin } };
  const bundle = createContextMemoryBundle({
    resources,
    workflows: {
      observe: createMemoryObserveDefinition({
        stepOverrides: {
          prepareInput: ({ state }) => {
            state.prepareInput();
            return Promise.resolve();
          },
        },
      }),
    },
  });
  await bundle.workflows.create.run({ input: { memoryId: request.memoryId, requestId: 'create' } });
  const input = { ...request, context: [{ role: 'user', content: 'A useful note' }] };

  await expect(bundle.workflows.observe.run({ input })).resolves.toMatchObject({
    status: 'unchanged',
  });
  expect(begin).toHaveBeenCalledOnce();
  const received = begin.mock.calls[0]?.[1];
  expect(received).toEqual(input);
  expect(received).not.toBe(input);
  if (received === undefined || !('context' in received)) throw new Error('Missing model context');
  expect(received.context).not.toBe(input.context);
});
