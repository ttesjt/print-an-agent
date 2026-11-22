import type { TextEmbeddingCapability } from '@print-an-agent/model-invocation-core';
import type { EmbeddingResolver } from './types.js';
import { assertNotAborted, fail, RetrievalMemoryError } from '../../errors.js';

export async function resolveEmbedding(
  resolver: EmbeddingResolver,
  ref: string,
  signal: AbortSignal,
  dimensions?: number
): Promise<TextEmbeddingCapability> {
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
