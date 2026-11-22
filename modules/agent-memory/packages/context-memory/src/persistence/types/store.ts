import type { MemoryState, MemorySnapshot } from '../../types/document.js';
import type { MutationRequest, MemoryReceipt, CommandOutcome } from '../../types/receipt.js';

/** Trusted persistence input. Only the domain boundary produces this for Workflow consumers. */
export interface StoreCommit {
  readonly request: MutationRequest;
  /** null means conditional creation; an existing identity must not be overwritten. */
  readonly expectedRevision: number | null;
  readonly state: MemoryState;
  readonly commandOutcomes: readonly CommandOutcome[];
}

/**
 * Borrowed, concurrent-safe persistence capability. Implementations atomically arbitrate
 * request identity before CAS, calculate revision/changes, and commit state plus receipt.
 * A rejected pre-commit call must not publish anything. Ambiguous commit failures must be explicit.
 * No model/counter invocation may run while a write transaction is held.
 */
export interface MemoryStore {
  read(memoryId: string, signal?: AbortSignal): Promise<MemorySnapshot | undefined>;
  getReceipt(
    memoryId: string,
    requestId: string,
    signal?: AbortSignal
  ): Promise<MemoryReceipt | undefined>;
  commit(change: StoreCommit, signal?: AbortSignal): Promise<MemoryReceipt>;
}
