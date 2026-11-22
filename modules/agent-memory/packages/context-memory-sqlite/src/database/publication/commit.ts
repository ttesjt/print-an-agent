import type { DatabaseSync } from 'node:sqlite';
import type { MemoryReceipt, StoreCommit } from '@print-an-agent/context-memory';
import { DEFAULT_MAX_MEMORY_DELTA_CHAIN } from '../history/index.js';
import { publishChange } from './publish-snapshot.js';
import { runMemoryTransaction } from './run-transaction.js';

/** Synchronous transaction: all model/measurement work has already completed before admission. */
export function commitTransaction(
  database: DatabaseSync,
  change: StoreCommit,
  signal?: AbortSignal,
  maxDeltaChain = DEFAULT_MAX_MEMORY_DELTA_CHAIN
): MemoryReceipt {
  return runMemoryTransaction(
    database,
    change.request,
    () => publishChange(database, change, maxDeltaChain),
    signal
  );
}
