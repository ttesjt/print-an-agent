import { expect, it } from 'vitest';
import {
  createContextMemoryHistoryBundle,
  createContextMemoryHistoryResources,
  createVersionedContextMemoryBundle,
  createVersionedContextMemoryResources,
  createMemoryForkDefinition,
  findContextMemoryCommit,
  readMemoryVersionContext,
  readMemoryContext,
} from '@print-an-agent/context-memory';
import { borrowed, domain } from './support/fixtures.js';
import { testCounter } from './support/counter.js';

it('uses the public versioned Bundle for current writes, historical rendering, paging and independent fork', async () => {
  const { store, meter, database } = borrowed();
  const resources = createVersionedContextMemoryResources({
    store,
    meter,
    defaults: { measurementRef: 'chars' },
  });
  const bundle = createVersionedContextMemoryBundle({ resources });
  await bundle.workflows.create.run({
    input: {
      memoryId: 'parent',
      requestId: 'create',
      items: [{ content: 'alpha' }, { content: 'beta' }],
    },
  });
  const first = await bundle.workflows.inspectVersion.run({
    input: { memoryId: 'parent', revision: 1 },
  });
  await bundle.workflows.configure.run({
    input: {
      memoryId: 'parent',
      requestId: 'config',
      expectedRevision: 1,
      config: { render: { format: 'json' } },
    },
  });
  const rendered = await bundle.workflows.readVersionContext.run({
    input: { memoryId: 'parent', revision: 1 },
  });
  expect(rendered?.text).toBe('alpha\nbeta');
  const request = {
    memoryId: 'child',
    requestId: 'fork',
    source: { memoryId: 'parent', revision: 1 },
  };
  const fork = await bundle.workflows.fork.run({ input: request });
  expect(fork).toMatchObject({
    status: 'committed',
    receipt: { operation: 'fork', previousRevision: null, revision: 1 },
  });
  const child = (await store.read('child'))!;
  expect(child.items).toEqual(first!.items);
  expect(child.config).toEqual(first!.config);
  expect(
    (await bundle.workflows.listVersions.run({ input: { memoryId: 'child' } }))?.versions
  ).toHaveLength(1);
  expect(await store.getReceipt('child', 'create')).toBeUndefined();
  database.prepare('DELETE FROM context_memory_documents WHERE memory_id = ?').run('parent');
  database.prepare('DELETE FROM context_memory_history WHERE memory_id = ?').run('parent');
  database.prepare('DELETE FROM context_memory_receipts WHERE memory_id = ?').run('parent');
  expect(await bundle.workflows.fork.run({ input: request })).toEqual(fork);
  expect(
    await bundle.workflows.inspectVersion.run({ input: { memoryId: 'child', revision: 1 } })
  ).toEqual(child);
  await expect(
    bundle.workflows.fork.run({
      input: { ...request, source: { memoryId: 'parent', revision: 2 } },
    })
  ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  await expect(
    bundle.workflows.fork.run({ input: { ...request, requestId: 'another' } })
  ).rejects.toMatchObject({ code: 'MEMORY_ALREADY_EXISTS' });
});

it('installs a state-only history Bundle without counter, renderer or model', async () => {
  const { store, mutations } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'create', items: [{ content: 'remember' }] });
  const bundle = createContextMemoryHistoryBundle({
    resources: createContextMemoryHistoryResources(store),
  });
  await bundle.workflows.fork.run({
    input: { memoryId: 'child', requestId: 'fork', source: { memoryId: 'm', revision: 1 } },
  });
  expect(
    (await bundle.workflows.inspectVersion.run({ input: { memoryId: 'child', revision: 1 } }))
      ?.items[0]?.content
  ).toBe('remember');
  expect(
    await bundle.workflows.getReceipt.run({ input: { memoryId: 'child', requestId: 'fork' } })
  ).toMatchObject({ operation: 'fork' });
  await expect(
    bundle.workflows.inspectVersion.run({ input: { memoryId: 'child', revision: 99 } })
  ).rejects.toMatchObject({ code: 'MEMORY_VERSION_NOT_FOUND' });
});

it('retains fork commit evidence if an official Executor fails after the commit', async () => {
  const { store, mutations } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'create' });
  const bundle = createContextMemoryHistoryBundle({
    resources: createContextMemoryHistoryResources(store),
    workflows: {
      fork: createMemoryForkDefinition({
        executeStep: async ({ stepName, context, step }) => {
          await step(context);
          if (stepName === 'executeOperation') throw new Error('cleanup failed');
        },
      }),
    },
  });
  const error: unknown = await bundle.workflows.fork
    .run({
      input: { memoryId: 'child', requestId: 'fork', source: { memoryId: 'm', revision: 1 } },
    })
    .catch((error: unknown) => error);
  expect(findContextMemoryCommit(error)).toMatchObject({
    status: 'committed',
    receipt: { memoryId: 'child', requestId: 'fork', revision: 1 },
  });
  expect((await store.read('child'))?.revision).toBe(1);
});

it('rejects historical rendering on a current-only adapter instead of returning current memory', async () => {
  const { store, mutations, meter } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'create' });
  const currentOnly = {
    read: store.read.bind(store),
    commit: store.commit.bind(store),
    getReceipt: store.getReceipt.bind(store),
  };
  await expect(
    readMemoryVersionContext({ store: currentOnly, meter }, { memoryId: 'm', revision: 1 })
  ).rejects.toMatchObject({ code: 'HISTORY_UNAVAILABLE' });
});

it('selects historical measurement config without implicitly upgrading the existing current read contract', async () => {
  const { store, mutations, meter } = borrowed();
  await mutations.create({ memoryId: 'm', requestId: 'create', items: [{ content: 'original' }] });
  const current = domain(
    store,
    testCounter((text) => Promise.resolve(text.length * 2), 'new')
  );
  await current.mutations.configure({
    memoryId: 'm',
    requestId: 'new-counter',
    expectedRevision: 1,
    config: { measurementRef: 'new' },
  });
  const old = await readMemoryVersionContext({ store, meter }, { memoryId: 'm', revision: 1 });
  expect(old.measurement.measurementRef).toBe('chars');
  expect(old.measurement.tokens).toBe(8);
  const head = await readMemoryContext({ store, meter: current.meter }, { memoryId: 'm' });
  expect(head.measurement.measurementRef).toBe('new');
  expect(head.measurement.tokens).toBe(16);
  const historicalInput = { memoryId: 'm', revision: 1 };
  await expect(readMemoryContext({ store, meter }, historicalInput)).rejects.toMatchObject({
    code: 'INPUT_INVALID',
  });
  expect((await store.read('m'))?.revision).toBe(2);
});
