import { AgentSessionError, type AgentSessionErrorCode } from '@print-an-agent/base-session';
import type { MemoryReceipt } from '@print-an-agent/context-memory';
import { hasSessionMemoryCleanupFailure } from './failures.js';

export class SessionMemoryCommitError extends AgentSessionError {
  constructor(
    readonly commit:
      | { readonly status: 'committed'; readonly receipt: MemoryReceipt }
      | { readonly status: 'not-committed' }
      | { readonly status: 'unknown'; readonly memoryId: string; readonly requestId: string },
    cause?: unknown,
    code: AgentSessionErrorCode = 'SESSION_MEMORY_PENDING'
  ) {
    super(
      hasSessionMemoryCleanupFailure(cause) ? 'SESSION_MEMORY_CLEANUP_FAILED' : code,
      commit.status === 'committed'
        ? 'Memory committed; coordination or post-processing failed.'
        : commit.status === 'not-committed'
          ? 'Memory was not committed; post-processing failed.'
          : 'Memory outcome is unresolved; recover the original receipt.',
      { cause }
    );
  }
}
