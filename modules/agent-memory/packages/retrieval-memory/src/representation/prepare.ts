import { randomUUID } from 'node:crypto';
import { EMBEDDING_TASK } from '@print-an-agent/model-invocation-core';
import type { EntryRepresentation } from '../types/representation.js';
import type { RetrievalEntry } from '../types/entry.js';
import type { RetrievalSpace } from '../types/space.js';
import type { ChunkerResolver } from './chunking/index.js';
import type { EmbeddingResolver } from './embedding/index.js';
import type { RetrievalPolicy } from '../policy/index.js';
import { assertNotAborted, fail, RetrievalMemoryError } from '../errors.js';
import { validateRepresentation } from './validation.js';
import { record } from '../values/index.js';
import { parseChunkContent } from './chunking/index.js';
import { embedTexts } from './embedding/index.js';

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
