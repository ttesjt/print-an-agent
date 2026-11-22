import type { DatabaseSync } from 'node:sqlite';
import { decideMemoryCommit } from '@print-an-agent/context-memory';
import type { MemoryReceipt, StoreCommit } from '@print-an-agent/context-memory';
import { readSnapshot, writeSnapshot } from '../persistence/index.js';
import { appendHistory } from '../history/index.js';

export function publishChange(
  database: DatabaseSync,
  change: StoreCommit,
  maxDeltaChain: number
): MemoryReceipt {
  const previous = readSnapshot(database, change.request.memoryId);
  const decision = decideMemoryCommit(previous, change);
  if (decision.receipt.status !== 'unchanged') {
    appendHistory(database, decision.snapshot, previous, maxDeltaChain);
    writeSnapshot(database, decision.snapshot);
  }
  return decision.receipt;
}
