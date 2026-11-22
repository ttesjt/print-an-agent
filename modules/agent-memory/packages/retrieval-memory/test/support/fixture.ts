import { createTextEmbedder } from '@print-an-agent/model-invocation-core';
import {
  createCodepointChunker,
  createRetrievalMutations,
  COSINE_METRIC_REF,
  decideRetrievalPublication,
  assertNotAborted,
  type RetrievalBackend,
  type RetrievalPublication,
  type RetrievalReceipt,
  type RetrievalSpace,
  type StoredEntry,
} from '@print-an-agent/retrieval-memory';
export function fixture() {
  const spaces = new Map<string, RetrievalSpace>();
  const entries = new Map<string, StoredEntry>();
  const receipts = new Map<string, RetrievalReceipt>();
  const key = (a: string, b: string) => JSON.stringify([a, b]);
  const calls = { embeddings: 0, publication: 0 };
  const embedder = createTextEmbedder({
    representation: {
      modelRef: 'fixture:v1',
      dimensions: 4,
      preprocessingRef: 'identity:v1',
      documentRecipeRef: 'same:v1',
      queryRecipeRef: 'same:v1',
      outputTransformRef: 'none:v1',
    },
    limits: { maxBatchSize: 2, maxBatchUtf8Bytes: null, maxInputUtf8Bytes: null },
    embed({ inputs }) {
      calls.embeddings++;
      return Promise.resolve(inputs.map((item) => ({ id: item.id, vector: [1e20, 0, 0, 0] })));
    },
  });
  const chunker = createCodepointChunker({ window: 12, overlap: 2 });
  const backend: RetrievalBackend = {
    inspect: (memoryId) => Promise.resolve(structuredClone(spaces.get(memoryId))),
    get: (memoryId, entryId) =>
      Promise.resolve(structuredClone(entries.get(key(memoryId, entryId)))),
    getReceipt: (memoryId, requestId) =>
      Promise.resolve(structuredClone(receipts.get(key(memoryId, requestId)))),
    async publish(candidate: RetrievalPublication, signal) {
      await Promise.resolve();
      assertNotAborted(signal);
      calls.publication++;
      const { mutation } = candidate;
      const { memoryId, requestId } = mutation.input;
      const entryId =
        candidate.entry?.entryId ?? ('entryId' in mutation.input ? mutation.input.entryId : null);
      const decision = decideRetrievalPublication(
        spaces.get(memoryId),
        entryId === null ? undefined : entries.get(key(memoryId, entryId)),
        receipts.get(key(memoryId, requestId)),
        candidate
      );
      if ('space' in decision) {
        spaces.set(memoryId, structuredClone(decision.space));
        if (entryId !== null) {
          if (decision.stored === null) entries.delete(key(memoryId, entryId));
          else entries.set(key(memoryId, entryId), structuredClone(decision.stored));
        }
        receipts.set(key(memoryId, requestId), decision.receipt);
      }
      return Promise.resolve(structuredClone(decision.receipt));
    },
    list: () => Promise.reject(new Error('Not part of this mutation test double.')),
    search: () => Promise.reject(new Error('Not part of this mutation test double.')),
  };
  const resources = {
    backend,
    embeddings: { resolve: () => embedder },
    chunkers: { resolve: () => chunker },
  };
  const mutations = createRetrievalMutations(resources);
  const create = (memoryId = 'space') =>
    mutations.run('create', {
      memoryId,
      requestId: 'create',
      index: {
        embeddingRef: embedder.descriptor.representationRef,
        chunkerRef: chunker.ref,
        metricRef: COSINE_METRIC_REF,
      },
    });
  return { mutations, resources, backend, spaces, entries, receipts, calls, create, key };
}
