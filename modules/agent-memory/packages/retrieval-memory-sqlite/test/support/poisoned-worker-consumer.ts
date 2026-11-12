import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createTextEmbedder } from '@print-an-agent/model-invocation-core';
import {
  COSINE_METRIC_REF,
  createCodepointChunker,
  createRetrievalMutations,
  RetrievalMemoryError,
} from '@print-an-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@print-an-agent/retrieval-memory-sqlite';

const path = process.argv[2]!;
const doubleFault = process.env.RETRIEVAL_TEST_DOUBLE_FAULT === '1';
function diagnostics(error: unknown): string[] {
  if (!(error instanceof Error)) return [];
  return [
    error.message,
    ...diagnostics(error.cause),
    ...(error instanceof AggregateError ? (error.errors as unknown[]).flatMap(diagnostics) : []),
  ];
}
const backend = await openSqliteRetrievalBackend({ path });
const embedder = createTextEmbedder({
  representation: {
    modelRef: 'fault:v1',
    dimensions: 4,
    preprocessingRef: 'identity:v1',
    documentRecipeRef: 'same:v1',
    queryRecipeRef: 'same:v1',
    outputTransformRef: 'none:v1',
  },
  limits: { maxBatchSize: 1, maxBatchUtf8Bytes: null, maxInputUtf8Bytes: null },
  embed: ({ inputs }) => Promise.resolve(inputs.map(({ id }) => ({ id, vector: [1, 0, 0, 0] }))),
});
const chunker = createCodepointChunker();
const mutations = createRetrievalMutations({
  backend,
  embeddings: { resolve: () => embedder },
  chunkers: { resolve: () => chunker },
});
const input = {
  memoryId: 'space',
  requestId: 'create',
  index: {
    embeddingRef: embedder.descriptor.representationRef,
    chunkerRef: chunker.ref,
    metricRef: COSINE_METRIC_REF,
  },
};
const signal = new AbortController().signal;
const prepared = await mutations.prepare('create', input, signal);
assert('publication' in prepared);
const outcomes = await Promise.allSettled([
  backend.publish(prepared.publication, signal),
  backend.inspect('space'), // Already queued when publication fails, not merely a later client call.
]);
assert.equal(outcomes[0]?.status, 'rejected');
if (outcomes[0]?.status !== 'rejected') throw new Error('Expected failed publication');
assert(outcomes[0].reason instanceof RetrievalMemoryError);
assert.deepEqual(
  { code: outcomes[0].reason.code, commit: outcomes[0].reason.commit },
  {
    code: doubleFault ? 'CLEANUP_FAILED' : 'COMMIT_UNKNOWN',
    commit: { status: 'unknown', memoryId: 'space', requestId: 'create' },
  }
);
const observer = new DatabaseSync(path);
const counts = () => [
  observer.prepare('SELECT COUNT(*) AS n FROM rm_spaces').get()?.n,
  observer.prepare('SELECT COUNT(*) AS n FROM rm_receipts').get()?.n,
];
try {
  assert.deepEqual(counts(), [0, 0]);
  if (doubleFault) {
    assert.equal(outcomes[1]?.status, 'rejected');
    if (outcomes[1]?.status === 'rejected') {
      assert(outcomes[1].reason instanceof RetrievalMemoryError);
      assert.equal(outcomes[1].reason.code, 'CLEANUP_FAILED');
    }
    for (const call of [
      () => backend.inspect('space'),
      () => backend.get('space', 'entry'),
      () => backend.getReceipt('space', 'create'),
      () => backend.list({ memoryId: 'space', limit: 1 }),
      () => backend.search({ space: prepared.publication.space, vector: [1, 0, 0, 0], topK: 1 }),
      () => mutations.run('create', input),
    ])
      await assert.rejects(call, { code: 'CLEANUP_FAILED' });
    await assert.rejects(
      backend.publish(
        {
          ...prepared.publication,
          mutation: { operation: 'create', input: { ...input, requestId: 'other' } },
        },
        signal
      ),
      { code: 'CLEANUP_FAILED', commit: { status: 'not-committed' } }
    );
    for (let attempt = 0; attempt < 2; attempt++)
      await assert.rejects(backend.close(), (error: unknown) => {
        assert(error instanceof RetrievalMemoryError);
        assert.equal(error.code, 'CLEANUP_FAILED');
        const messages = diagnostics(error);
        assert(messages.includes('injected COMMIT before execution'));
        assert(messages.includes('injected ROLLBACK failure'));
        if (process.env.RETRIEVAL_TEST_CLOSE_FAULT === '1')
          assert(messages.includes('injected close failure after release'));
        return true;
      });
    assert.deepEqual(counts(), [0, 0]);
    const reopened = await openSqliteRetrievalBackend({ path });
    try {
      assert.equal(await reopened.inspect('space'), undefined);
      assert.equal(await reopened.getReceipt('space', 'create'), undefined);
    } finally {
      // Fault mode deliberately injects close failure on every worker connection.
      if (process.env.RETRIEVAL_TEST_CLOSE_FAULT === '1')
        await assert.rejects(reopened.close(), { code: 'CLEANUP_FAILED' });
      else await reopened.close();
    }
  } else {
    assert.deepEqual(outcomes[1], { status: 'fulfilled', value: undefined });
    assert.equal(await backend.getReceipt('space', 'create'), undefined);
    assert.equal((await mutations.run('create', input)).status, 'committed');
    assert.deepEqual(counts(), [1, 1]);
    await backend.close();
  }
} finally {
  observer.close();
  await backend.close().catch(() => undefined);
}
