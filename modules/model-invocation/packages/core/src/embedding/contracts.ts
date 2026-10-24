export const EMBEDDING_TASK = Object.freeze({ DOCUMENT: 'document', QUERY: 'query' } as const);
export type EmbeddingTask = (typeof EMBEDDING_TASK)[keyof typeof EMBEDDING_TASK];

/** Versioned references are host/implementation commitments, not verified remote weights. */
export interface TextEmbeddingRepresentation {
  readonly modelRef: string;
  readonly dimensions: number;
  readonly preprocessingRef: string;
  readonly documentRecipeRef: string;
  readonly queryRecipeRef: string;
  readonly outputTransformRef: string;
}

/** null means unknown/not locally bounded, never a claim that the model accepts unlimited input. */
export interface TextEmbeddingLimits {
  readonly maxBatchSize: number | null;
  readonly maxInputUtf8Bytes: number | null;
  readonly maxBatchUtf8Bytes: number | null;
}

export interface TextEmbeddingDescriptor {
  readonly representationRef: string;
  readonly representation: TextEmbeddingRepresentation;
  readonly inputKind: 'text';
  readonly tasks: readonly EmbeddingTask[];
  readonly limits: TextEmbeddingLimits;
}

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

export const NO_EMBEDDING_TIMEOUT = null;
export const MAX_EMBEDDING_TIMEOUT_MILLISECONDS = 2_147_483_647;

export interface TextEmbeddingInvocationPolicy {
  /** null adds no local deadline; caller cancellation still applies. */
  readonly timeoutMilliseconds: number | null;
}

export interface TextEmbedderDefinition {
  readonly representation: TextEmbeddingRepresentation;
  readonly limits: TextEmbeddingLimits;
  readonly invocationPolicy?: TextEmbeddingInvocationPolicy;
  /** Borrowed implementation; task recipes and any additional model-specific limits are its job. */
  readonly embed: (request: TextEmbeddingRequest) => Promise<readonly TextEmbeddingVector[]>;
}
