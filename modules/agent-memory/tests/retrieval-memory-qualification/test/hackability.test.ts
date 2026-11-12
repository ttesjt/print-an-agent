import { Workflow } from '@print-an-agent/workflow-core';
import {
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import {
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  createRetrievalSearchDefinition,
  createRetrievalIngestDefinition,
  findRetrievalCommit,
} from '@print-an-agent/retrieval-memory';
import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
it('replaces a complete Workflow definition and a named Step without forking the runner or adapter', async () => {
  const f = await fixture();
  await f.create();
  let visits = 0;
  const replacement = createRetrievalSearchDefinition({
    stepOverrides: {
      prepareInput: (context) => {
        visits++;
        context.state.input = { ...context.input, topK: 1 };
        return Promise.resolve();
      },
    },
  });
  const standalone = new Workflow({ ...replacement, resources: f.resources });
  const bundle = createRetrievalMemoryBundle({
    resources: f.resources,
    workflows: { search: replacement },
  });
  for (const requestId of ['a', 'b'])
    await f.bundle.workflows.ingest.run({
      input: { memoryId: 'space', requestId, content: 'match' },
    });
  expect(await standalone.run({ input: { memoryId: 'space', query: 'x' } })).toMatchObject({
    status: 'completed',
    value: { hits: [expect.anything()] },
  });
  const result = await bundle.workflows.search.run({ input: { memoryId: 'space', query: 'x' } });
  if (result.status !== 'completed') throw new Error('Unexpected skip');
  expect(result.value.hits).toHaveLength(1);
  expect(visits).toBe(2);
});
it('replaces chunking and rendering through typed resources while preserving the same guarded writes', async () => {
  const f = await fixture();
  const chunker = {
    ref: 'custom:transformed:v1',
    chunk: (content: string) => Promise.resolve([{ text: content.toUpperCase(), span: null }]),
  };
  const resources = createRetrievalWorkflowResources(
    { ...f.ports, chunkers: { resolve: () => chunker } },
    {
      context: {
        counter: createTokenCounter({
          measurementRef: 'consumer:characters:v1',
          inputContract: TEXT_TOKEN_INPUT_CONTRACT,
          measure: ({ text }) => Promise.resolve({ tokens: text.length, accuracy: 'exact' }),
        }),
        defaultRendererRef: 'custom:plain:v1',
        renderers: {
          resolve: () => ({
            ref: 'custom:plain:v1',
            render: ({ hits, separator }) => hits.map((hit) => hit.text).join(separator),
          }),
        },
      },
    }
  );
  const w = createRetrievalMemoryBundle({ resources }).workflows;
  await w.create.run({
    input: {
      memoryId: 'custom',
      requestId: 'create',
      index: { ...f.index, chunkerRef: chunker.ref },
    },
  });
  await w.ingest.run({ input: { memoryId: 'custom', requestId: 'a', content: 'lowercase' } });
  const result = await w.readContext.run({
    input: { memoryId: 'custom', query: 'x', maxTokens: 20 },
  });
  expect(result).toMatchObject({
    status: 'completed',
    value: { text: 'LOWERCASE', hits: [{ span: null }] },
  });
});
it('preserves a committed receipt and independent executor/finally failures', async () => {
  const f = await fixture();
  await f.create();
  const definition = createRetrievalIngestDefinition({
    executeStep: async (execution) => {
      await execution.step(execution.context);
      if (execution.stepName === 'publish') throw new Error('executor failed');
    },
    lifecycle: {
      onFinally: () => {
        throw new Error('finally failed');
      },
    },
  });
  const error = await new Workflow({ ...definition, resources: f.resources })
    .run({ input: { memoryId: 'space', requestId: 'saved', content: 'match' } })
    .catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(AggregateError);
  expect(findRetrievalCommit(error)).toMatchObject({
    status: 'committed',
    receipt: { requestId: 'saved' },
  });
  expect(
    (await f.queries.getReceipt({ memoryId: 'space', requestId: 'saved' }, f.signal))?.sequence
  ).toBe(1);
});
it('recovers a remote lost reply without replaying the model or duplicating content', async () => {
  const f = await fixture();
  await f.create();
  if (!('faults' in f.owned)) throw new Error('Expected opaque fixture');
  f.owned.faults.dropReply = true;
  const input = { memoryId: 'space', requestId: 'lost', content: 'match' };
  await expect(f.mutations.run('ingest', input)).rejects.toMatchObject({
    code: 'COMMIT_UNKNOWN',
    commit: { status: 'unknown' },
  });
  const result = await f.mutations.run('ingest', input);
  expect(result.receipt.sequence).toBe(1);
  expect((await f.queries.list({ memoryId: 'space' }, f.signal)).entries).toHaveLength(1);
});
