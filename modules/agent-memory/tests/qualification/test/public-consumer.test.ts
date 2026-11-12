import { expect, it } from 'vitest';
import { Workflow } from '@print-an-agent/workflow-core';
import {
  MemoryMeter,
  createMemoryEditDefinition,
  readMemoryVersionContext,
} from '@print-an-agent/context-memory';
import { createTiktokenTextCounter } from '@print-an-agent/model-invocation-token-counters';
import { consumer, plannerActor, vocabularyCounter } from './support/model.js';
import { memoryPath, ownedStore } from './support/storage.js';
import { runProjectMemoryExample } from '../examples/project-memory.js';

it('consumes all eight entries with an official exact counter and reopens without model recomputation', async () => {
  const path = await memoryPath();
  const store = ownedStore(path);
  const counter = createTiktokenTextCounter({ encoding: 'o200k_base' });
  const resources = {
    meter: new MemoryMeter({ counter }),
    defaults: { measurementRef: counter.descriptor.measurementRef, maxContextTokens: 128 },
  };
  const client = consumer(
    store,
    (request) => {
      const first = request.items[0];
      if (first === undefined) throw new Error('Expected the initial item.');
      if (request.task === 'observe') return [{ op: 'add', content: 'Prefer tea.' }];
      if (request.task === 'edit')
        return [{ op: 'replace', itemId: first.id, content: 'Short answers.' }];
      return [
        { op: 'replace', itemId: first.id, content: 'Tea' },
        ...request.items.slice(1).map((item) => ({ op: 'remove' as const, itemId: item.id })),
      ];
    },
    { resources }
  );
  const workflows = client.bundle.workflows;
  await workflows.create.run({
    input: { memoryId: 'project', requestId: 'create', items: [{ content: 'Be concise.' }] },
  });
  const observation = {
    memoryId: 'project',
    requestId: 'observe',
    context: [{ role: 'user', content: 'I prefer tea.', source: { eventId: 'experience:1' } }],
  };
  await workflows.observe.run({ input: observation });
  await workflows.edit.run({
    input: { memoryId: 'project', requestId: 'edit', instruction: 'Shorten the first item.' },
  });
  await workflows.apply.run({
    input: {
      memoryId: 'project',
      requestId: 'apply',
      expectedRevision: 3,
      commands: [{ op: 'add', content: 'No sugar.' }],
    },
  });
  await workflows.compact.run({
    input: { memoryId: 'project', requestId: 'compact', target: { maxTokens: 2 } },
  });
  await workflows.configure.run({
    input: {
      memoryId: 'project',
      requestId: 'configure',
      expectedRevision: 5,
      config: { render: { format: 'json' } },
    },
  });
  const result = await workflows.readContext.run({ input: { memoryId: 'project' } });
  expect(result?.snapshot.revision).toBe(6);
  expect(result?.measurement).toMatchObject({
    accuracy: 'exact',
    scope: 'text',
    measurementRef: counter.descriptor.measurementRef,
  });
  expect(JSON.parse(result?.text ?? '')).toEqual(
    result?.snapshot.items.map(({ id, content }) => ({ id, content }))
  );
  const receipt = await workflows.getReceipt.run({
    input: { memoryId: 'project', requestId: 'observe' },
  });
  expect(
    (await store.listVersions({ memoryId: 'project' })).versions.map((ref) => ref.revision)
  ).toEqual([6, 5, 4, 3, 2, 1]);
  expect(
    (await store.readVersion({ memoryId: 'project', revision: 1 }))?.items.map(
      (item) => item.content
    )
  ).toEqual(['Be concise.']);
  expect(
    (await store.readVersion({ memoryId: 'project', revision: 2 }))?.items.map(
      (item) => item.content
    )
  ).toEqual(['Be concise.', 'Prefer tea.']);
  expect(
    (await store.readVersion({ memoryId: 'project', revision: 5 }))?.config.render.format
  ).toBe('text');
  expect(client.actor.requests).toHaveLength(3);
  store.close();
  const reopened = consumer(
    ownedStore(path),
    () => {
      throw new Error('A replay must not plan.');
    },
    { resources }
  );
  expect(await reopened.bundle.workflows.observe.run({ input: observation })).toEqual({
    status: 'committed',
    receipt,
  });
  expect(
    await reopened.bundle.workflows.readContext.run({ input: { memoryId: 'project' } })
  ).toEqual(result);
  expect(reopened.actor.requests).toHaveLength(0);
  expect(
    (
      await readMemoryVersionContext(
        { store: ownedStore(path), meter: resources.meter },
        { memoryId: 'project', revision: 1 }
      )
    )?.text
  ).toBe('Be concise.');
});

it('runs the documented host example repeatedly using borrowed model/counter capabilities', async () => {
  const path = await memoryPath();
  const actor = plannerActor(() => [{ op: 'add', content: 'Prefer concise answers.' }]);
  const options = { path, completion: actor.completion, counter: vocabularyCounter() };
  const first = await runProjectMemoryExample(options);
  expect(first?.text).toBe('Prefer concise answers.');
  expect(await runProjectMemoryExample(options)).toEqual(first);
  expect(actor.requests).toHaveLength(1);
  expect(actor.active).toBe(0);
});

it('uses the same resource-free definition in an independent native Workflow', async () => {
  const client = consumer(ownedStore(await memoryPath()), () => [{ op: 'add', content: 'new' }]);
  await client.bundle.workflows.create.run({ input: { memoryId: 'a', requestId: 'create' } });
  const workflow = new Workflow({ ...createMemoryEditDefinition(), resources: client.resources });
  const input = { memoryId: 'a', requestId: 'edit', instruction: 'remember' };
  const result = await workflow.run({ input });
  expect(await client.bundle.workflows.edit.run({ input })).toEqual(result);
  expect(client.actor.requests).toHaveLength(1);
});
