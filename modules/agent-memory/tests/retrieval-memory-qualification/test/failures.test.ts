import { expect, it } from 'vitest';
import {
  createRetrievalMutations,
  createRetrievalQueries,
  RetrievalMemoryError,
} from '@ta-agent/retrieval-memory';
import { fixture } from './support/fixture.js';
it('rejects Unicode before remote reads and preserves valid supplementary characters', async () => {
  const f = await fixture();
  let reads = 0;
  const inspect = f.ports.backend.inspect.bind(f.ports.backend);
  f.ports.backend.inspect = (...args) => {
    reads++;
    return inspect(...args);
  };
  await expect(f.queries.inspect({ memoryId: 'space-\ud800' }, f.signal)).rejects.toMatchObject({
    code: 'INPUT_INVALID',
  });
  await expect(
    f.queries.getReceipt({ memoryId: 'space', requestId: '\ud801' }, f.signal)
  ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  expect(reads).toBe(0);
  await f.create('😀');
  expect((await f.queries.inspect({ memoryId: '😀' }, f.signal)).memoryId).toBe('😀');
});
it('does not publish after provider failure or expose its private text in a public error', async () => {
  const f = await fixture();
  await f.create();
  const capability = {
    ...f.embedder,
    embed: () => Promise.reject(new Error('private provider details')),
  };
  const mutations = createRetrievalMutations({
    ...f.ports,
    embeddings: { resolve: () => capability },
  });
  const error = await mutations
    .run('ingest', { memoryId: 'space', requestId: 'fail', content: 'match' })
    .catch((cause: unknown) => cause);
  expect(error).toMatchObject({ code: 'EMBEDDING_FAILED', commit: { status: 'not-committed' } });
  if (!(error instanceof Error)) throw new Error('Expected error');
  expect(error.message).not.toContain('private');
  expect((await f.queries.inspect({ memoryId: 'space' }, f.signal)).sequence).toBe(0);
});
it('does not attach mutation evidence to ordinary read failures', async () => {
  const f = await fixture();
  await f.create();
  const queries = createRetrievalQueries({
    ...f.ports,
    backend: {
      ...f.ports.backend,
      inspect: () => Promise.reject(new RetrievalMemoryError('STORAGE_FAILED', 'Unavailable.')),
    },
  });
  await expect(queries.inspect({ memoryId: 'space' }, f.signal)).rejects.toMatchObject({
    code: 'STORAGE_FAILED',
    commit: undefined,
  });
});
it('retains a replayed receipt even when cancellation is delivered with its remote read', async () => {
  const f = await fixture();
  const created = await f.create();
  const abort = new AbortController();
  const get = f.ports.backend.getReceipt.bind(f.ports.backend);
  f.ports.backend.getReceipt = async (...args) => {
    const receipt = await get(...args);
    abort.abort();
    return receipt;
  };
  expect(
    await f.mutations.run(
      'create',
      { memoryId: 'space', requestId: 'create', index: f.index },
      abort.signal
    )
  ).toEqual(created);
});
it('rejects undeclared backend hit payload instead of forwarding extra vectors or provider data', async () => {
  const f = await fixture();
  await f.create();
  await f.mutations.run('ingest', { memoryId: 'space', requestId: 'a', content: 'match' });
  const search = f.ports.backend.search.bind(f.ports.backend);
  f.ports.backend.search = async (...args) => {
    const result = await search(...args);
    return { ...result, hits: result.hits.map((hit) => ({ ...hit, vector: [1, 0, 0, 0] })) };
  };
  await expect(f.queries.search({ memoryId: 'space', query: 'x' }, f.signal)).rejects.toMatchObject(
    { code: 'SEARCH_FAILED' }
  );
});
