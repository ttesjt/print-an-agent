import { EmbeddingError } from '@print-an-agent/model-invocation-core';
import type { RetrievalSpace } from '../../types/space.js';
import type { EmbeddingResolver } from './types.js';
import type { RetrievalPolicy } from '../../policy/index.js';
import { assertNotAborted, fail, RetrievalMemoryError } from '../../errors.js';
import { prepareCosineVector } from '../metric.js';
import { record } from '../../values/index.js';
import { resolveEmbedding } from './resolve.js';

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
