export type EmbeddingErrorCode =
  | 'EMBEDDING_BINDING_INVALID'
  | 'EMBEDDING_INPUT_INVALID'
  | 'EMBEDDING_INPUT_LIMIT_EXCEEDED'
  | 'EMBEDDING_RESPONSE_INVALID'
  | 'EMBEDDING_PROVIDER_FAILED'
  | 'EMBEDDING_INVOCATION_CANCELLED'
  | 'EMBEDDING_INVOCATION_TIMEOUT';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmbeddingError';
    this.code = code;
  }
}
