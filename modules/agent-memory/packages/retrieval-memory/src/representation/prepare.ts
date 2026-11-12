import { randomUUID } from 'node:crypto';
import { EMBEDDING_TASK, EmbeddingError } from '@print-an-agent/model-invocation-core';
import type { EntryRepresentation, RetrievalEntry, RetrievalSpace } from '../contracts/data.js';
import type { ChunkerResolver, EmbeddingResolver } from '../contracts/ports.js';
import type { RetrievalPolicy } from '../config.js';
import { assertNotAborted, fail, RetrievalMemoryError } from '../errors.js';
import { prepareCosineVector } from './metric.js';
import { validateRepresentation } from '../validation/state.js';
import { record } from '../validation/json.js';
import { parseChunkContent } from '../validation/chunks.js';
export async function resolveEmbedding(
  resolver: EmbeddingResolver,
  ref: string,
  signal: AbortSignal,
  dimensions?: number
) {
  assertNotAborted(signal);
  let capability;
  try {
    capability = await resolver.resolve(ref, signal);
  } catch (cause) {
    assertNotAborted(signal);
    throw new RetrievalMemoryError('EMBEDDING_FAILED', 'Embedding binding could not be resolved.', {
      cause,
    });
  }
  assertNotAborted(signal);
  if (
    capability.descriptor.representationRef !== ref ||
    (dimensions !== undefined && capability.descriptor.representation.dimensions !== dimensions)
  )
    fail('EMBEDDING_MISMATCH', 'Embedding binding does not match the Space representation.');
  return capability;
}
export async function embedTexts(
  resolver: EmbeddingResolver,
  space: RetrievalSpace,
  texts: readonly string[],
  task: 'document' | 'query',
  policy: RetrievalPolicy,
  signal: AbortSignal
): Promise<readonly (readonly number[])[]> {
  const capability = await resolveEmbedding(
    resolver,
    space.index.embeddingRef,
    signal,
    space.index.dimensions
  );
  const batchSize = Math.min(
    policy.embeddingBatchSize,
    capability.descriptor.limits.maxBatchSize ?? policy.embeddingBatchSize
  );
  const vectors: (readonly number[])[] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    assertNotAborted(signal);
    const inputs = texts
      .slice(offset, offset + batchSize)
      .map((text, i) => ({ id: `input-${i}`, text }));
    let result;
    try {
      result = await capability.embed({ task, inputs, signal });
    } catch (cause) {
      assertNotAborted(signal);
      throw new RetrievalMemoryError(
        cause instanceof EmbeddingError && cause.code === 'EMBEDDING_INVOCATION_TIMEOUT'
          ? 'OPERATION_TIMED_OUT'
          : cause instanceof EmbeddingError && cause.code === 'EMBEDDING_RESPONSE_INVALID'
            ? 'EMBEDDING_INVALID'
            : 'EMBEDDING_FAILED',
        'Embedding invocation failed.',
        { cause }
      );
    }
    assertNotAborted(signal);
    try {
      record(result);
    } catch (cause) {
      throw new RetrievalMemoryError('EMBEDDING_INVALID', 'Embedding result is malformed.', {
        cause,
      });
    }
    if (
      result.representationRef !== space.index.embeddingRef ||
      result.task !== task ||
      result.embeddings.length !== inputs.length
    )
      fail('EMBEDDING_MISMATCH', 'Embedding result identity or batch does not match.');
    const byId = new Map(result.embeddings.map((item) => [item.id, item.vector]));
    if (byId.size !== inputs.length)
      fail('EMBEDDING_INVALID', 'Embedding batch has duplicate results.');
    for (const input of inputs) {
      const raw = byId.get(input.id);
      if (raw === undefined) fail('EMBEDDING_INVALID', 'Embedding batch is incomplete.');
      vectors.push(prepareCosineVector(raw, space.index.dimensions));
    }
  }
  return vectors;
}
export async function prepareRepresentation(
  entry: RetrievalEntry,
  space: RetrievalSpace,
  resources: { embeddings: EmbeddingResolver; chunkers: ChunkerResolver },
  policy: RetrievalPolicy,
  signal: AbortSignal
): Promise<EntryRepresentation> {
  assertNotAborted(signal);
  const chunker = await resources.chunkers.resolve(space.index.chunkerRef, signal);
  assertNotAborted(signal);
  if (chunker.ref !== space.index.chunkerRef)
    fail('REPRESENTATION_INVALID', 'Chunker binding identity mismatch.');
  let contents;
  try {
    contents = structuredClone(await chunker.chunk(entry.content, signal));
  } catch (cause) {
    assertNotAborted(signal);
    throw new RetrievalMemoryError('CHUNKING_FAILED', 'Chunk preparation failed.', { cause });
  }
  record({ contents });
  if (
    contents.length === 0 ||
    (policy.maxChunksPerEntry !== null && contents.length > policy.maxChunksPerEntry)
  )
    fail('CHUNKING_FAILED', 'Chunk count is invalid.');
  // Validate spans/text before calling an external embedding service.
  const representationId = randomUUID();
  const chunks = contents.map((chunk, ordinal) => ({
    ...parseChunkContent(chunk, entry.content),
    memoryId: entry.memoryId,
    entryId: entry.entryId,
    entryRevision: entry.revision,
    generationId: space.index.generationId,
    representationId,
    chunkId: randomUUID(),
    ordinal,
  }));
  const shell = {
    representationId,
    embeddingRef: space.index.embeddingRef,
    chunkerRef: space.index.chunkerRef,
    metricRef: space.index.metricRef,
    chunks,
  };
  const vectors = await embedTexts(
    resources.embeddings,
    space,
    chunks.map((chunk) => chunk.text),
    EMBEDDING_TASK.DOCUMENT,
    policy,
    signal
  );
  return validateRepresentation(
    { ...shell, chunks: chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i]! })) },
    entry,
    space
  );
}
