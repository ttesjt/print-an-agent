import { expect, it } from 'vitest';
import {
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  createRetrievalQueries,
} from '@ta-agent/retrieval-memory';
import { fixture } from './support/fixture.js';
it('runs the full basic loop through public native workflows and real storage', async () => {
  const f = await fixture();
  const bundle = createRetrievalMemoryBundle({
    resources: createRetrievalWorkflowResources(f.resources),
  });
  const w = bundle.workflows;
  await w.create.run({ input: { memoryId: 'space', requestId: 'create', index: f.index } });
  const a = await w.ingest.run({
    input: { memoryId: 'space', requestId: 'a', content: 'aligned', metadata: { tag: 'yes' } },
  });
  if (a.status === 'skipped') throw new Error('Unexpected skip');
  const entryId = a.receipt.entryId!;
  const found = await w.search.run({
    input: {
      memoryId: 'space',
      query: 'aligned query',
      filter: { op: 'eq', path: ['tag'], value: 'yes' },
    },
  });
  expect(found).toMatchObject({
    status: 'completed',
    value: { hits: [{ entryId, text: 'aligned' }] },
  });
  expect(await w.get.run({ input: { memoryId: 'space', entryId } })).toMatchObject({
    status: 'completed',
    value: { content: 'aligned' },
  });
  expect(await w.list.run({ input: { memoryId: 'space' } })).toMatchObject({
    status: 'completed',
    value: { entries: [{ entryId }] },
  });
  await w.update.run({
    input: {
      memoryId: 'space',
      requestId: 'edit',
      entryId,
      expectedRevision: 1,
      content: 'angled',
    },
  });
  await w.remove.run({
    input: { memoryId: 'space', requestId: 'remove', entryId, expectedRevision: 2 },
  });
  expect(await w.getReceipt.run({ input: { memoryId: 'space', requestId: 'a' } })).toMatchObject({
    status: 'completed',
    value: a.receipt,
  });
  expect(await w.search.run({ input: { memoryId: 'space', query: 'aligned' } })).toMatchObject({
    status: 'completed',
    value: { hits: [] },
  });
});
it('isolates simultaneous Bundle runs across Spaces and never closes borrowed storage on abort', async () => {
  const f = await fixture();
  await f.create();
  await f.create('other');
  const queries = createRetrievalQueries(f.resources);
  const one = createRetrievalMemoryBundle({
    resources: createRetrievalWorkflowResources(f.resources),
  });
  const two = createRetrievalMemoryBundle({
    resources: createRetrievalWorkflowResources(f.resources),
  });
  await Promise.all([
    one.workflows.ingest.run({
      input: { memoryId: 'space', requestId: 'a', content: 'aligned first' },
    }),
    two.workflows.ingest.run({
      input: { memoryId: 'other', requestId: 'b', content: 'angled other' },
    }),
  ]);
  expect(
    (
      await queries.search({ memoryId: 'space', query: 'aligned' }, new AbortController().signal)
    ).hits.map((hit) => hit.text)
  ).toEqual(['aligned first']);
  const abort = new AbortController();
  abort.abort();
  await expect(
    one.workflows.search.run({ input: { memoryId: 'space', query: 'x' }, signal: abort.signal })
  ).rejects.toBeDefined();
  expect(
    (await queries.inspect({ memoryId: 'other' }, new AbortController().signal)).sequence
  ).toBe(1);
});
it('rejects unsupported or malformed query inputs before encoding and validates backend hit scope', async () => {
  const f = await fixture();
  await f.create();
  const queries = createRetrievalQueries(f.resources);
  const signal = new AbortController().signal;
  for (const input of [
    { memoryId: 'space', query: '\ud800' },
    { memoryId: 'space', query: 'x', future: true },
    { memoryId: 'space', query: 'x', filter: { op: 'or', filters: [] } },
  ])
    await expect(queries.search(input, signal)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'aligned' });
  const search = f.backend.search.bind(f.backend);
  f.backend.search = async (...args) => {
    const result = await search(...args);
    return { ...result, hits: result.hits.map((hit) => ({ ...hit, memoryId: 'wrong' })) };
  };
  await expect(
    queries.search({ memoryId: 'space', query: 'aligned' }, signal)
  ).rejects.toMatchObject({ code: 'SEARCH_FAILED' });
});
