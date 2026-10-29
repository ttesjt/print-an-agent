import type { MemorySnapshot } from './document.js';
import type { MemoryReceipt } from './receipt.js';
import type { MemoryStore } from './ports.js';
import type { ReadContextInput } from './inputs.js';

/** Logical, store-scoped identity. Physical history representation is not part of this reference. */
export interface MemoryVersionReference {
  readonly memoryId: string;
  readonly revision: number;
}
export interface ReadMemoryVersionContextInput extends ReadContextInput {
  readonly revision: number;
}
export interface ListMemoryVersionsInput {
  readonly memoryId: string;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface MemoryHistoryPage {
  readonly memoryId: string;
  /** A stable upper bound captured by the first page, including across later writes. */
  readonly throughRevision: number;
  readonly versions: readonly MemoryVersionReference[];
  readonly nextCursor?: string;
}
export interface ForkMemoryInput {
  readonly memoryId: string;
  readonly requestId: string;
  readonly source: MemoryVersionReference;
}
/**
 * Optional, explicit persistence capability. Existing current-state adapters do not pretend to
 * support history. A matching fork receipt wins before source lookup, CAS or late cancellation.
 * Fork conditionally creates revision 1 from an immutable source in this same store authority.
 */
export interface MemoryHistoryStore extends MemoryStore {
  readVersion(
    reference: MemoryVersionReference,
    signal?: AbortSignal
  ): Promise<MemorySnapshot | undefined>;
  listVersions(input: ListMemoryVersionsInput, signal?: AbortSignal): Promise<MemoryHistoryPage>;
  fork(input: ForkMemoryInput, signal?: AbortSignal): Promise<MemoryReceipt>;
}
export const DEFAULT_MEMORY_HISTORY_PAGE_SIZE = 20;
export const MAX_MEMORY_HISTORY_PAGE_SIZE = 100;
