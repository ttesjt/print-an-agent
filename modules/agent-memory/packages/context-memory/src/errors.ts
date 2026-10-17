import type { MemoryErrorOptions } from './contracts/receipt.js';

export type ContextMemoryErrorCode =
  | 'INPUT_INVALID'
  | 'COMMAND_INVALID'
  | 'ITEM_NOT_FOUND'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_ALREADY_EXISTS'
  | 'REVISION_CONFLICT'
  | 'REQUEST_CONFLICT'
  | 'CONFIG_INVALID'
  | 'TOKENIZER_UNAVAILABLE'
  | 'BUDGET_EXCEEDED'
  | 'COMPACTION_EXHAUSTED'
  | 'CONFLICT_RETRIES_EXHAUSTED'
  | 'MODEL_OUTPUT_INVALID'
  | 'MODEL_INVOCATION_FAILED'
  | 'OPERATION_ABORTED'
  | 'OPERATION_TIMEOUT'
  | 'STORAGE_FAILED'
  | 'CLEANUP_FAILED'
  | 'COMMIT_STATUS_UNKNOWN';

export class ContextMemoryError extends Error {
  readonly memoryId;
  readonly details;
  readonly commit;
  constructor(
    readonly code: ContextMemoryErrorCode,
    message: string,
    options: MemoryErrorOptions = {}
  ) {
    super(message, options);
    this.name = 'ContextMemoryError';
    this.memoryId = options.memoryId;
    this.details = options.details ?? {};
    this.commit = options.commit;
  }
}

export function assertMemoryNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ContextMemoryError('OPERATION_ABORTED', 'Memory operation was cancelled.', {
      cause: signal.reason,
      commit: { status: 'not-committed' },
    });
}
