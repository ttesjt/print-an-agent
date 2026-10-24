import type {
  TextEmbeddingCapability,
  TextTokenInput,
  TokenCounter,
} from '@ta-agent/model-invocation-core';
import {
  createCodepointChunker,
  createRetrievalMemoryBundle,
  createRetrievalWorkflowResources,
  COSINE_METRIC_REF,
  type RetrievalBackend,
} from '@ta-agent/retrieval-memory';
/** Host composition only. The caller owns its backend/model and drains runs before closing them. */
export function composeProjectKnowledge(options: {
  readonly backend: RetrievalBackend;
  readonly embedder: TextEmbeddingCapability;
  readonly counter?: TokenCounter<TextTokenInput>;
}) {
  const chunker = createCodepointChunker();
  const resources = createRetrievalWorkflowResources(
    {
      backend: options.backend,
      embeddings: { resolve: () => options.embedder },
      chunkers: { resolve: () => chunker },
    },
    { context: options.counter === undefined ? {} : { counter: options.counter } }
  );
  return {
    bundle: createRetrievalMemoryBundle({ resources }),
    index: {
      embeddingRef: options.embedder.descriptor.representationRef,
      chunkerRef: chunker.ref,
      metricRef: COSINE_METRIC_REF,
    },
  };
}
