import type { EmbeddingTask } from '../tasks.js';
import type {
  TextEmbeddingDescriptor,
  TextEmbeddingRepresentation,
  TextEmbeddingLimits,
} from './descriptor.js';
import type { TextEmbeddingInvocationPolicy } from '../invocation-policy.js';

export interface TextEmbeddingInput {
  readonly id: string;
  readonly text: string;
}

export interface TextEmbeddingRequest {
  readonly task: EmbeddingTask;
  readonly inputs: readonly TextEmbeddingInput[];
  readonly signal: AbortSignal;
}

export interface TextEmbeddingVector {
  readonly id: string;
  readonly vector: readonly number[];
}

export interface TextEmbeddingResult {
  readonly representationRef: string;
  readonly task: EmbeddingTask;
  /** Complete results in request order, with detached immutable vector storage. */
  readonly embeddings: readonly TextEmbeddingVector[];
}

export interface TextEmbeddingCapability {
  readonly descriptor: TextEmbeddingDescriptor;
  readonly embed: (request: TextEmbeddingRequest) => Promise<TextEmbeddingResult>;
}

export interface TextEmbedderDefinition {
  readonly representation: TextEmbeddingRepresentation;
  readonly limits: TextEmbeddingLimits;
  readonly invocationPolicy?: TextEmbeddingInvocationPolicy;
  /** Borrowed implementation; task recipes and any additional model-specific limits are its job. */
  readonly embed: (request: TextEmbeddingRequest) => Promise<readonly TextEmbeddingVector[]>;
}
