import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import { createTextEmbedder } from '@print-an-agent/model-invocation-core';
import {
  COSINE_METRIC_REF,
  createCodepointChunker,
  createRetrievalMutations,
  prepareCosineVector,
  type BackendSearch,
} from '@print-an-agent/retrieval-memory';
import {
  openSqliteRetrievalBackend,
  type OwnedRetrievalBackend,
} from '@print-an-agent/retrieval-memory-sqlite';
export async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'retrieval-memory-test-'));
  const path = join(directory, 'memory.db');
  const connections: OwnedRetrievalBackend[] = [];
  onTestFinished(async () => {
    try {
      await Promise.all(connections.map((connection) => connection.close()));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  const connect = async () => {
    const backend = await openSqliteRetrievalBackend({ path });
    connections.push(backend);
    return backend;
  };
  const backend = await connect();
  const capability = createTextEmbedder({
    representation: {
      modelRef: 'test:v1',
      dimensions: 4,
      preprocessingRef: 'identity:v1',
      documentRecipeRef: 'same:v1',
      queryRecipeRef: 'same:v1',
      outputTransformRef: 'numbers:v1',
    },
    limits: { maxBatchSize: 64, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed: ({ inputs }) =>
      Promise.resolve(
        inputs.map(({ id, text }) => ({
          id,
          vector: text.includes('aligned')
            ? [1e20, 0, 0, 0]
            : text.includes('angled')
              ? [0.8, 0.6, 0, 0]
              : [0, 1, 0, 0],
        }))
      ),
  });
  const chunker = createCodepointChunker();
  const resources = {
    backend,
    embeddings: { resolve: () => capability },
    chunkers: { resolve: () => chunker },
  };
  const mutations = createRetrievalMutations(resources);
  const index = {
    embeddingRef: capability.descriptor.representationRef,
    chunkerRef: chunker.ref,
    metricRef: COSINE_METRIC_REF,
  };
  const create = (memoryId = 'space') =>
    mutations.run('create', { memoryId, requestId: 'create', index });
  const search = async (
    memoryId = 'space',
    options: Partial<Pick<BackendSearch, 'filter' | 'topK'>> = {}
  ) => {
    const space = await backend.inspect(memoryId);
    if (space === undefined) throw new Error('Missing test Space');
    return backend.search({
      space,
      vector: prepareCosineVector([1, 0, 0, 0], 4),
      topK: 10,
      ...options,
    });
  };
  return { path, backend, connect, resources, mutations, create, search, index };
}
