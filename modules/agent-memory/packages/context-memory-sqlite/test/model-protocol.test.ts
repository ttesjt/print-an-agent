import { expect, it } from 'vitest';
import { Workflow, skipWorkflow } from '@print-an-agent/workflow-core';
import {
  createContextMemoryBundle,
  createModelMemoryResources,
  createMemoryObserveDefinition,
  createMemoryEditDefinition,
  ContextMemoryError,
} from '@print-an-agent/context-memory';
import { borrowed } from './support/fixtures.js';
import { modelFixture } from './support/model.js';

it.each([
  '{"items":[]}',
  'not JSON',
  '[{"op":"add","itemId":"forged","content":"new"}]',
  '[{"op":"add","content":"new","metadata":{"private":"forged"}}]',
])('rejects non-operations or system-field model output %s without retries', async (output) => {
  const fixture = modelFixture(() => output);
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await expect(
    fixture.bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
    })
  ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID', commit: { status: 'not-committed' } });
  expect(fixture.requests).toHaveLength(1);
  expect((await fixture.store.read('a'))?.revision).toBe(1);
});

it('never accepts a syntactically valid but truncated operations response', async () => {
  const fixture = modelFixture(() => [{ op: 'add', content: 'new' }], { stopReason: 'length' });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  await expect(
    fixture.bundle.workflows.edit.run({
      input: { memoryId: 'a', requestId: 'edit', instruction: 'change' },
    })
  ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  expect(await fixture.store.getReceipt('a', 'edit')).toBeUndefined();
  expect(fixture.requests).toHaveLength(1);
});

it('allows custom instructions, a standalone definition and full definition replacement', async () => {
  const definition = createMemoryEditDefinition();
  const fixture = modelFixture(() => [{ op: 'add', content: 'new' }], {
    instructions: { edit: 'A custom editing policy.' },
    workflows: { edit: definition },
  });
  await fixture.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const standalone = new Workflow({ ...definition, resources: fixture.resources });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'change' };
  const result = await standalone.run({ input });
  expect(await fixture.bundle.workflows.edit.run({ input })).toEqual(result);
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.instructions[0]).toContain('A custom editing policy.');
  expect(fixture.instructions[0]).toContain('JSON array of edit operations');
});

it('does not run a planner or reserve a receipt when a model Workflow is skipped', async () => {
  const fixture = modelFixture(() => [], {
    workflows: {
      observe: createMemoryObserveDefinition({ condition: () => skipWorkflow('user policy') }),
    },
  });
  expect(
    await fixture.bundle.workflows.observe.run({
      input: { memoryId: 'missing', requestId: 'observe', context: [] },
    })
  ).toMatchObject({ status: 'skipped' });
  expect(fixture.requests).toHaveLength(0);
  expect(await fixture.store.getReceipt('missing', 'observe')).toBeUndefined();
});

it('retains committed errors and recovers on replay without calling the planner again', async () => {
  const base = borrowed();
  let plans = 0;
  const resources = createModelMemoryResources({
    store: {
      read: base.store.read.bind(base.store),
      getReceipt: base.store.getReceipt.bind(base.store),
      commit: async (change, signal) => {
        const receipt = await base.store.commit(change, signal);
        throw new ContextMemoryError('CLEANUP_FAILED', 'lost delivery after commit', {
          commit: { status: 'committed', receipt },
        });
      },
    },
    meter: base.meter,
    defaults: { measurementRef: 'chars' },
    planner: {
      plan: () => {
        plans++;
        return Promise.resolve([{ op: 'add' as const, content: 'new' }]);
      },
    },
  });
  await base.mutations.create({ memoryId: 'a', requestId: 'create' });
  const bundle = createContextMemoryBundle({ resources });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'change' };
  await expect(bundle.workflows.edit.run({ input })).rejects.toMatchObject({
    code: 'CLEANUP_FAILED',
    commit: { status: 'committed', receipt: { revision: 2 } },
  });
  expect(await bundle.workflows.edit.run({ input })).toMatchObject({
    status: 'committed',
    receipt: { revision: 2 },
  });
  expect(plans).toBe(1);
});
