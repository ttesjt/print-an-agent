import type { CommitStatus, ContextMemoryErrorCode } from '@print-an-agent/context-memory';
import type { CommitEvidence, RetrievalErrorCode } from '@print-an-agent/retrieval-memory';
import type { AgentMemoryReference } from './types/reference.js';

export type MemoryManagementErrorCode =
  | 'MEMORY_CAPABILITY_UNAVAILABLE'
  | 'MEMORY_AGENT_NOT_FOUND'
  | 'MEMORY_INPUT_INVALID'
  | 'MEMORY_OPERATION_FAILED'
  | 'MEMORY_OPERATION_ABORTED';
export type ManagedMemoryFailure =
  | {
      readonly domain: 'context';
      readonly code: ContextMemoryErrorCode;
      readonly commit?: CommitStatus;
      readonly details?: Readonly<Record<string, string | number>>;
    }
  | {
      readonly domain: 'retrieval';
      readonly code: RetrievalErrorCode;
      readonly commit?: CommitEvidence;
    };

/** Public summary is deliberately small. Internal cause is not a transport DTO. */
export class MemoryManagementError extends Error {
  readonly name = 'MemoryManagementError';
  constructor(
    readonly code: MemoryManagementErrorCode,
    readonly target: AgentMemoryReference | undefined,
    readonly failure?: ManagedMemoryFailure,
    options?: ErrorOptions
  ) {
    super(
      code === 'MEMORY_CAPABILITY_UNAVAILABLE'
        ? 'Memory management capability is not installed.'
        : code === 'MEMORY_AGENT_NOT_FOUND'
          ? 'Agent was not found.'
          : code === 'MEMORY_INPUT_INVALID'
            ? 'Memory management input is invalid.'
            : code === 'MEMORY_OPERATION_ABORTED'
              ? 'Memory management operation was cancelled.'
              : 'Memory management operation failed.',
      options
    );
  }
}
