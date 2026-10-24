import {
  EMBEDDING_TASK,
  type TextEmbedderDefinition,
  type TextEmbeddingRequest,
} from '../../src/index.js';

/** Protocol fixture only, not a semantic embedding model. */
export function embeddingDefinition(): TextEmbedderDefinition {
  return {
    representation: {
      modelRef: 'fixture:weights-1',
      dimensions: 2,
      preprocessingRef: 'identity',
      documentRecipeRef: 'fixture:document-1',
      queryRecipeRef: 'fixture:query-1',
      outputTransformRef: 'identity',
    },
    limits: { maxBatchSize: null, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed: (request) => Promise.resolve(request.inputs.map(({ id }) => ({ id, vector: [1, 0] }))),
  };
}

export function embeddingRequest(
  signal: AbortSignal = new AbortController().signal
): TextEmbeddingRequest {
  return { task: EMBEDDING_TASK.DOCUMENT, inputs: [{ id: 'first', text: 'hello' }], signal };
}
