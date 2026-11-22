import type { MemorySnapshot } from '../../types/document.js';
import type { MemoryReceipt } from '../../types/receipt.js';
import type { MemoryStore } from '../../persistence/index.js';
import type { MemoryVersionReference } from './reference.js';
import type { ListMemoryVersionsInput, MemoryHistoryPage } from './queries.js';
import type { ForkMemoryInput } from './fork.js';

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
