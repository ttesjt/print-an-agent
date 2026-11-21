export { EMBEDDING_TASK } from './tasks.js';
export { MAX_EMBEDDING_TIMEOUT_MILLISECONDS, NO_EMBEDDING_TIMEOUT } from './invocation-policy.js';
export type { EmbeddingTask } from './tasks.js';
export type {
  TextEmbedderDefinition,
  TextEmbeddingCapability,
  TextEmbeddingInput,
  TextEmbeddingRequest,
  TextEmbeddingResult,
  TextEmbeddingVector,
} from './types/invocation.js';
export type {
  TextEmbeddingDescriptor,
  TextEmbeddingLimits,
  TextEmbeddingRepresentation,
} from './types/descriptor.js';
export type { TextEmbeddingInvocationPolicy } from './invocation-policy.js';
export { EmbeddingError } from './errors.js';
export type { EmbeddingErrorCode } from './errors.js';
export { createTextEmbedder } from './embedder.js';
