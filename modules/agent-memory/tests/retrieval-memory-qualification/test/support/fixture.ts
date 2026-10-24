import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { onTestFinished } from 'vitest';
import { createTextEmbedder } from '@ta-agent/model-invocation-core';
import {
  createCodepointChunker,
  createRetrievalMemoryBundle,
  createRetrievalMutations,
  createRetrievalQueries,
  createRetrievalWorkflowResources,
  COSINE_METRIC_REF,
} from '@ta-agent/retrieval-memory';
import { openSqliteRetrievalBackend } from '@ta-agent/retrieval-memory-sqlite';
import { opaqueBackend } from './opaque-backend.js';
export async function fixture(kind: 'opaque' | 'sqlite' = 'opaque') {
  const directory = mkdtempSync(join(tmpdir(), 'retrieval-consumer-'));
  const owned =
    kind === 'opaque'
      ? opaqueBackend()
      : {
          backend: await openSqliteRetrievalBackend({ path: join(directory, 'memory.db') }),
          close: async function () {
            await this.backend.close();
          },
        };
  onTestFinished(async () => {
    try {
      await owned.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const embedder = createTextEmbedder({
    representation: {
      modelRef: 'consumer-test:v1',
      dimensions: 4,
      preprocessingRef: 'identity:v1',
      documentRecipeRef: 'document:v1',
      queryRecipeRef: 'query:v1',
      outputTransformRef: 'numbers:v1',
    },
    limits: { maxBatchSize: 2, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed: ({ inputs, task }) =>
      Promise.resolve(
        [...inputs].reverse().map((input) => ({
          id: input.id,
          vector:
            task === 'query' || input.text.includes('match') ? [1e20, 0, 0, 0] : [0, 1e-30, 0, 0],
        }))
      ),
  });
  const chunker = createCodepointChunker({ window: 20, overlap: 0 });
  const ports = {
    backend: owned.backend,
    embeddings: { resolve: () => embedder },
    chunkers: { resolve: () => chunker },
  };
  const resources = createRetrievalWorkflowResources(ports);
  const bundle = createRetrievalMemoryBundle({ resources });
  const index = {
    embeddingRef: embedder.descriptor.representationRef,
    chunkerRef: chunker.ref,
    metricRef: COSINE_METRIC_REF,
  };
  const mutations = createRetrievalMutations(ports);
  const queries = createRetrievalQueries(ports);
  const signal: AbortSignal = new AbortController().signal;
  const create = (memoryId = 'space') =>
    mutations.run('create', { memoryId, requestId: 'create', index });
  return {
    owned,
    ports,
    resources,
    bundle,
    index,
    mutations,
    queries,
    create,
    signal,
    embedder,
    chunker,
  };
}
