import { createCodepointChunker, createRetrievalMutations } from '@print-an-agent/retrieval-memory';
import { expect, it } from 'vitest';
import { fixture } from './support/fixture.js';
it('hydrates ordered binary chunks across read, reindex and a shorter replacement without stale vectors', async () => {
  const f = await fixture();
  const chunker = createCodepointChunker({ window: 4, overlap: 1 });
  const mutations = createRetrievalMutations({
    ...f.resources,
    chunkers: { resolve: () => chunker },
  });
  await mutations.run('create', {
    memoryId: 'many',
    requestId: 'create',
    index: { ...f.index, chunkerRef: chunker.ref },
  });
  const content = 'a😀b\0c deFGH';
  const expected = await chunker.chunk(content, new AbortController().signal);
  const { receipt } = await mutations.run('ingest', { memoryId: 'many', requestId: 'a', content });
  const entryId = receipt.entryId!;
  const before = await f.backend.get('many', entryId);
  expect(before?.entry.content).toBe(content);
  expect(before?.representation.chunks.map(({ text, span }) => ({ text, span }))).toEqual(expected);
  expect(before?.representation.chunks.every((chunk) => chunk.vector.length === 4)).toBe(true);
  await mutations.run('reindex', {
    memoryId: 'many',
    requestId: 'reindex',
    entryId,
    expectedRevision: 1,
  });
  const rebuilt = await f.backend.get('many', entryId);
  expect(rebuilt?.entry).toEqual(before?.entry);
  expect(rebuilt?.representation.representationId).not.toBe(
    before?.representation.representationId
  );
  await mutations.run('update', {
    memoryId: 'many',
    requestId: 'replace',
    entryId,
    expectedRevision: 1,
    content: 'new',
  });
  const result = await f.backend.search({
    space: (await f.backend.inspect('many'))!,
    vector: [0, 1, 0, 0],
    topK: 100,
  });
  expect(result.hits.map((hit) => hit.text)).toEqual(['new']);
  expect((await f.backend.inspect('many'))?.sequence).toBe(3);
});
