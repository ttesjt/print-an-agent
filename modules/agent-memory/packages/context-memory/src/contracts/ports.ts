import type { MemoryItem, MemorySnapshot, RenderOptions } from './document.js';
import type { MemoryReceipt, StoreCommit } from './receipt.js';

export interface MemoryRenderer {
  /** Stable implementation identity; options are also included in measurement identity. */
  readonly id: string;
  render(
    items: readonly MemoryItem[],
    options: RenderOptions,
    signal: AbortSignal
  ): Promise<string>;
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
