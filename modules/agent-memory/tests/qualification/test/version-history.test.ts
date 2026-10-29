import { expect, it } from 'vitest';
import {
  createVersionedContextMemoryBundle,
  createVersionedContextMemoryResources,
  createMemoryInspectVersionDefinition,
  MemoryMeter,
  type MemoryVersionReference,
} from '@ta-agent/context-memory';
import { vocabularyCounter } from './support/model.js';
import { VersionStore } from './support/version-store.js';

it('consumes versioned memory through public packages with a genuinely independent store', async () => {
  const store = new VersionStore();
  const counter = vocabularyCounter();
  const resources = createVersionedContextMemoryResources({
    store,
    meter: new MemoryMeter({ counter }),
    defaults: { measurementRef: counter.descriptor.measurementRef },
  });
  const bundle = createVersionedContextMemoryBundle({ resources });
  await bundle.workflows.create.run({
    input: { memoryId: 'a', requestId: 'create', items: [{ content: 'initial' }] },
  });
  const input: MemoryVersionReference = { memoryId: 'a', revision: 1 };
  await bundle.workflows.apply.run({
    input: {
      memoryId: 'a',
      requestId: 'tool',
      expectedRevision: 1,
      commands: [{ op: 'add', content: 'decision' }],
    },
  });
  const final: MemoryVersionReference = { memoryId: 'a', revision: 2 };
  // These references stand in for caller-owned durable checkpoints, not Session framework code.
  await bundle.workflows.apply.run({
    input: {
      memoryId: 'a',
      requestId: 'future',
      expectedRevision: 2,
      commands: [{ op: 'add', content: 'future information' }],
    },
  });
  expect(
    (await bundle.workflows.inspectVersion.run({ input }))?.items.map((i) => i.content)
  ).toEqual(['initial']);
  await bundle.workflows.fork.run({ input: { memoryId: 'b', requestId: 'fork', source: final } });
  expect((await bundle.workflows.readContext.run({ input: { memoryId: 'b' } }))?.text).toBe(
    'initial\ndecision'
  );
  store.heads.delete('a');
  store.versions.delete('a');
  expect(
    (await bundle.workflows.inspectVersion.run({ input: { memoryId: 'b', revision: 1 } }))?.items
  ).toHaveLength(2);
  expect(
    (await bundle.workflows.listVersions.run({ input: { memoryId: 'b' } }))?.versions
  ).toHaveLength(1);
});

it('replaces named Steps and the entire historical graph without changing the resource recipe', async () => {
  const store = new VersionStore();
  const counter = vocabularyCounter();
  const resources = createVersionedContextMemoryResources({
    store,
    meter: new MemoryMeter({ counter }),
    defaults: { measurementRef: counter.descriptor.measurementRef },
  });
  const base = createMemoryInspectVersionDefinition();
  const defaultStep = base.stepDefinitions.executeOperation.step;
  if (defaultStep === undefined) throw new Error('Missing default Step.');
  let visits = 0;
  const custom = createVersionedContextMemoryBundle({
    resources,
    workflows: {
      inspectVersion: createMemoryInspectVersionDefinition({
        stepOverrides: {
          executeOperation: async (context) => {
            visits++;
            await defaultStep(context);
          },
        },
      }),
    },
  });
  await custom.workflows.create.run({ input: { memoryId: 'm', requestId: 'create' } });
  await custom.workflows.inspectVersion.run({ input: { memoryId: 'm', revision: 1 } });
  expect(visits).toBe(1);
  const alternate = createVersionedContextMemoryBundle({
    resources,
    workflows: {
      inspectVersion: {
        ...base,
        entryStep: 'executeOperation',
        stepDefinitions: {
          ...base.stepDefinitions,
          executeOperation: {
            cardinality: 'at-most-once',
            skippable: false,
            step: async (context) => {
              context.result = await context.resources.memory.inspectVersion(
                context.input,
                context.signal
              );
            },
          },
        },
      },
    },
  });
  expect(
    await alternate.workflows.inspectVersion.run({ input: { memoryId: 'm', revision: 1 } })
  ).toEqual(await store.read('m'));
  await expect(
    alternate.workflows.inspectVersion.run({ input: { memoryId: 'm', revision: 2 } })
  ).rejects.toMatchObject({ code: 'MEMORY_VERSION_NOT_FOUND' });
});
