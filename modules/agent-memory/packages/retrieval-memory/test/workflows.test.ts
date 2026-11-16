import { expect, it } from 'vitest';
import { Workflow, skipWorkflow } from '@print-an-agent/workflow-core';
import {
  createRetrievalCreateDefinition,
  createRetrievalIngestDefinition,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  findRetrievalCommit,
} from '../src/index.js';
import { fixture } from './support/fixture.js';
it('assembles native standalone and Bundle mutations using the same borrowed domain resources', async () => {
  const f = fixture();
  const resources = createRetrievalWorkflowResources(f.resources);
  const bundle = createRetrievalMemoryBundle({ resources });
  const created = await f.create();
  const index = f.spaces.get('space')!.index;
  const definition = createRetrievalCreateDefinition();
  const standalone = new Workflow({ ...definition, resources });
  expect(
    await standalone.run({
      input: {
        memoryId: 'other',
        requestId: 'create',
        index: {
          embeddingRef: index.embeddingRef,
          chunkerRef: index.chunkerRef,
          metricRef: index.metricRef,
        },
      },
    })
  ).toMatchObject({ status: 'committed' });
  expect(
    (
      await bundle.workflows.ingest.run({
        input: { memoryId: 'space', requestId: 'a', content: 'text' },
      })
    ).status
  ).toBe('committed');
  expect(created.status).toBe('committed');
  expect(f.spaces.size).toBe(2);
});
it.each(['executor', 'success', 'finally'] as const)(
  'retains committed facts when %s post-processing fails',
  async (mode) => {
    const f = fixture();
    await f.create();
    const resources = createRetrievalWorkflowResources(f.resources);
    const definition = createRetrievalIngestDefinition({
      ...(mode === 'executor'
        ? {
            executeStep: async (execution) => {
              await execution.step(execution.context);
              if (execution.stepName === 'publish') throw new Error('executor cleanup');
            },
          }
        : {
            lifecycle:
              mode === 'success'
                ? {
                    onSuccess: () => {
                      throw new Error('success hook');
                    },
                  }
                : {
                    onFinally: () => {
                      throw new Error('finally hook');
                    },
                  },
          }),
    });
    const workflow = new Workflow({ ...definition, resources });
    const error = await workflow
      .run({ input: { memoryId: 'space', requestId: mode, content: 'text' } })
      .catch((cause: unknown) => cause);
    expect(findRetrievalCommit(error)).toMatchObject({
      status: 'committed',
      receipt: { sequence: 1, requestId: mode },
    });
    expect(f.entries.size).toBe(1);
  }
);
it('allows a named preparation Step override but guarded publication still rejects mismatched scope', async () => {
  const f = fixture();
  await f.create();
  const resources = createRetrievalWorkflowResources(f.resources);
  const definition = createRetrievalIngestDefinition({
    stepOverrides: {
      prepareCandidate: async (context) => {
        const prepared = await context.resources.mutations.prepare(
          'ingest',
          context.state.input,
          context.signal
        );
        if (!('publication' in prepared)) throw new Error('Expected candidate');
        context.state.candidate = {
          publication: {
            ...prepared.publication,
            space: { ...prepared.publication.space, memoryId: 'wrong' },
          },
        };
      },
    },
  });
  await expect(
    new Workflow({ ...definition, resources }).run({
      input: { memoryId: 'space', requestId: 'bad', content: 'text' },
    })
  ).rejects.toMatchObject({ code: 'REPRESENTATION_INVALID' });
  expect(f.entries.size).toBe(0);
});
it('supports explicit Workflow skip without acquiring or closing resources', async () => {
  const f = fixture();
  const workflow = new Workflow({
    ...createRetrievalIngestDefinition({ condition: () => skipWorkflow('not needed') }),
    resources: createRetrievalWorkflowResources(f.resources),
  });
  expect(
    (await workflow.run({ input: { memoryId: 'missing', requestId: 'a', content: 'x' } })).status
  ).toBe('skipped');
  expect(f.calls).toEqual({ embeddings: 0, publication: 0 });
});

it('distinguishes an explicit Step outcome from an override that produces nothing', async () => {
  const f = fixture();
  const resources = createRetrievalWorkflowResources(f.resources);
  const input = { memoryId: 'missing', requestId: 'a', content: 'x' };
  const missingOutput = createRetrievalIngestDefinition({
    stepOverrides: { runOperation: () => Promise.resolve() },
  });
  await expect(new Workflow({ ...missingOutput, resources }).run({ input })).rejects.toMatchObject({
    code: 'REPRESENTATION_INVALID',
  });
  const skipped = createRetrievalIngestDefinition({
    stepOverrides: {
      runOperation({ state }) {
        state.outcome = { status: 'skipped', reason: 'consumer policy' };
        return Promise.resolve();
      },
    },
  });
  await expect(new Workflow({ ...skipped, resources }).run({ input })).resolves.toEqual({
    status: 'skipped',
    reason: 'consumer policy',
  });
  expect(f.calls).toEqual({ embeddings: 0, publication: 0 });
});
