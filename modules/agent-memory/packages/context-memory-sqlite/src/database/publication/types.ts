import type { MemoryReceipt } from '@print-an-agent/context-memory';

/** Facts observed by this request's transaction owner before failure recovery begins. */
export interface TransactionProgress {
  readonly beginAttempted: boolean;
  readonly started: boolean;
  readonly knownReceipt: MemoryReceipt | undefined;
}
