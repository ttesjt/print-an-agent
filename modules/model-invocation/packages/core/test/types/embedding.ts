import type { TextEmbeddingCapability, TextEmbeddingVector } from '../../src/index.js';
import { EMBEDDING_TASK } from '../../src/index.js';

type Assert<T extends true> = T;
export type EmbeddingDoesNotRequireGeneration = Assert<
  'complete' extends keyof TextEmbeddingCapability ? false : true
>;
export type EmbeddingVectorIsReadonly = Assert<
  TextEmbeddingVector['vector'] extends number[] ? false : true
>;

export async function independentEmbeddingConsumer(
  capability: TextEmbeddingCapability,
  signal: AbortSignal
) {
  const result = await capability.embed({
    task: EMBEDDING_TASK.QUERY,
    inputs: [{ id: 'query', text: 'question' }],
    signal,
  });
  return result;
}
