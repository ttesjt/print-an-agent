import type { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import type { MemorySnapshot } from '@print-an-agent/context-memory';
import { encodeHistory, snapshotDigest } from './codec.js';
import { readHistoryRecord, writeHistoryRecord } from './records.js';
import { readHistoricalSnapshot } from './read-version.js';

export function appendHistory(
  database: DatabaseSync,
  snapshot: MemorySnapshot,
  previous: MemorySnapshot | undefined,
  maxDeltaChain: number
): void {
  if (previous !== undefined) {
    const recovered = readHistoricalSnapshot(database, previous);
    if (recovered === undefined || snapshotDigest(recovered) !== snapshotDigest(previous))
      throw new ContextMemoryError('HISTORY_CORRUPT', 'Current memory history is unavailable.', {
        memoryId: snapshot.memoryId,
      });
  }
  const prior = previous === undefined ? undefined : readHistoryRecord(database, previous);
  if (previous !== undefined && (prior === undefined || prior.digest !== snapshotDigest(previous)))
    throw new ContextMemoryError(
      'HISTORY_CORRUPT',
      'Current memory does not match its immutable history.',
      { memoryId: snapshot.memoryId }
    );
  writeHistoryRecord(database, encodeHistory(snapshot, previous, prior?.depth ?? 0, maxDeltaChain));
}
