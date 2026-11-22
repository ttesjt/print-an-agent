import { expect, it, vi } from 'vitest';

import { Workflow, skipWorkflow } from '@print-an-agent/workflow-core';

import {
  createContextMemoryBundle,
  createContextMemoryResources,
  createMemoryCreateDefinition,
  createMemoryApplyDefinition,
  createMemoryReadContextDefinition,
  MemoryMeter,
} from '@print-an-agent/context-memory';

import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';

import { borrowed, fileStores } from '../../../support/fixtures.js';

import { testCounter } from '../../../support/counter.js';

function resources(store: SqliteMemoryStore) {
  const meter = new MemoryMeter({ counter: testCounter() });
  return createContextMemoryResources({ store, meter, defaults: { measurementRef: 'chars' } });
}

it('runs the five public Workflows against SQLite and restores durable receipts after reopen', async () => {
  const { first, second, path, register } = await fileStores();
  const bundle = createContextMemoryBundle({ resources: resources(first) });
  await bundle.workflows.create.run({ input: { memoryId: 'project:a', requestId: 'create' } });
  await bundle.workflows.apply.run({
    input: {
      memoryId: 'project:a',
      requestId: 'add',
      expectedRevision: 1,
      commands: [
        { op: 'add', content: 'one' },
        { op: 'add', content: 'two' },
      ],
    },
  });
  const result = await bundle.workflows.configure.run({
    input: {
      memoryId: 'project:a',
      requestId: 'config',
      expectedRevision: 2,
      config: { render: { format: 'text', separator: ' | ' } },
    },
  });
  expect(
    await bundle.workflows.readContext.run({ input: { memoryId: 'project:a' } })
  ).toMatchObject({ text: 'one | two', snapshot: { revision: 3 } });
  first.close();
  second.close();
  const reopened = new SqliteMemoryStore({ path });
  register(reopened);
  const next = createContextMemoryBundle({ resources: resources(reopened) });
  if (result.status === 'skipped') throw new Error('Unexpected skip.');
  expect(
    await next.workflows.getReceipt.run({ input: { memoryId: 'project:a', requestId: 'config' } })
  ).toEqual(result.receipt);
  expect(
    await next.workflows.getReceipt.run({ input: { memoryId: 'project:a', requestId: 'missing' } })
  ).toBeUndefined();
});

it('uses one definition independently and in a Bundle without closing borrowed resources', async () => {
  const { store, database } = borrowed();
  const bound = resources(store);
  const create = createMemoryCreateDefinition();
  const standalone = new Workflow({ ...create, resources: bound });
  const bundle = createContextMemoryBundle({ resources: bound, workflows: { create } });
  const input = { memoryId: 'a', requestId: 'create' };
  expect(await standalone.run({ input })).toEqual(await bundle.workflows.create.run({ input }));
  await bundle.workflows.create.run({ input: { memoryId: 'b', requestId: 'create' } });
  expect(database.isOpen).toBe(true);
  expect(await bundle.workflows.readContext.run({ input: { memoryId: 'b' } })).toMatchObject({
    text: '',
  });
});

it('skips truthfully, without running hooks, writing receipts or inventing query results', async () => {
  const { store } = borrowed();
  const hook = vi.fn();
  const bundle = createContextMemoryBundle({
    resources: resources(store),
    workflows: {
      create: createMemoryCreateDefinition({
        condition: () => skipWorkflow('caller filter'),
        lifecycle: { onSuccess: hook },
      }),
      readContext: createMemoryReadContextDefinition({
        condition: () => skipWorkflow('caller filter'),
      }),
    },
  });
  expect(
    await bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } })
  ).toMatchObject({ status: 'skipped' });
  expect(await bundle.workflows.readContext.run({ input: { memoryId: 'a' } })).toBeUndefined();
  expect(await store.getReceipt('a', 'create')).toBeUndefined();
  expect(hook).not.toHaveBeenCalled();
});

it('a replaced preparation Step cannot bypass the real domain budget', async () => {
  const { store } = borrowed();
  const bundle = createContextMemoryBundle({
    resources: resources(store),
    workflows: {
      apply: createMemoryApplyDefinition({
        stepOverrides: {
          prepareInput: (context) => {
            context.state.prepareInput({
              ...context.state.input,
              commands: [{ op: 'add', content: 'too long' }],
            });
            return Promise.resolve();
          },
        },
      }),
    },
  });
  await bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', config: { maxContextTokens: 2 } },
  });
  await expect(
    bundle.workflows.apply.run({
      input: { memoryId: 'a', requestId: 'apply', expectedRevision: 1, commands: [] },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED', commit: { status: 'not-committed' } });
  expect((await store.read('a'))?.revision).toBe(1);
});

it.each(['onSuccess', 'onFinally'] as const)(
  'preserves the durable receipt when %s fails after commit',
  async (phase) => {
    const { store } = borrowed();
    const bundle = createContextMemoryBundle({
      resources: resources(store),
      workflows: {
        create: createMemoryCreateDefinition({
          lifecycle: {
            [phase]: () => {
              throw new Error('hook failure');
            },
          },
        }),
      },
    });
    await expect(
      bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } })
    ).rejects.toMatchObject({
      code: 'CLEANUP_FAILED',
      commit: { status: 'committed', receipt: { revision: 1 } },
    });
    expect(await store.getReceipt('a', 'create')).toMatchObject({ revision: 1 });
  }
);

it('configure rejects oversized separators atomically and missing queries remain errors', async () => {
  const { store } = borrowed();
  const bundle = createContextMemoryBundle({ resources: resources(store) });
  await bundle.workflows.create.run({
    input: {
      memoryId: 'a',
      requestId: 'create',
      config: { maxContextTokens: 3 },
      items: [{ content: 'a' }, { content: 'b' }],
    },
  });
  await expect(
    bundle.workflows.configure.run({
      input: {
        memoryId: 'a',
        requestId: 'config',
        expectedRevision: 1,
        config: { render: { format: 'text', separator: 'long separator' } },
      },
    })
  ).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  expect(await bundle.workflows.readContext.run({ input: { memoryId: 'a' } })).toMatchObject({
    text: 'a\nb',
    snapshot: { revision: 1 },
  });
  await expect(
    bundle.workflows.readContext.run({ input: { memoryId: 'missing' } })
  ).rejects.toMatchObject({ code: 'MEMORY_NOT_FOUND' });
});
