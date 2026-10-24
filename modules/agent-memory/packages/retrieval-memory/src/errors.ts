import type { CommitEvidence } from './contracts/publication.js';
export type RetrievalErrorCode =
  | 'INPUT_INVALID'
  | 'CONFIG_INVALID'
  | 'UNSUPPORTED_CAPABILITY'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_ALREADY_EXISTS'
  | 'ENTRY_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'REQUEST_CONFLICT'
  | 'STALE_CURSOR'
  | 'EMBEDDING_FAILED'
  | 'EMBEDDING_INVALID'
  | 'EMBEDDING_MISMATCH'
  | 'CHUNKING_FAILED'
  | 'REPRESENTATION_INVALID'
  | 'SEARCH_FAILED'
  | 'TOKEN_COUNTER_REQUIRED'
  | 'MEASUREMENT_FAILED'
  | 'CONTEXT_BUDGET_EXCEEDED'
  | 'OPERATION_ABORTED'
  | 'OPERATION_TIMED_OUT'
  | 'STORAGE_FAILED'
  | 'COMMIT_UNKNOWN'
  | 'CLEANUP_FAILED';
export class RetrievalMemoryError extends Error {
  readonly name = 'RetrievalMemoryError';
  readonly commit?: CommitEvidence;
  constructor(
    readonly code: RetrievalErrorCode,
    message: string,
    options: ErrorOptions & { commit?: CommitEvidence } = {}
  ) {
    super(message, options);
    if (options.commit !== undefined) this.commit = options.commit;
  }
}
export function fail(code: RetrievalErrorCode, message: string): never {
  throw new RetrievalMemoryError(code, message);
}
export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new RetrievalMemoryError('OPERATION_ABORTED', 'Memory operation was cancelled.', {
      cause: signal.reason,
    });
}
