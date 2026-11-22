import { readHistoryBaseline, readHistoryRange, decodeRow, readHistoryRecord } from './records.js';
import type { DatabaseSync } from 'node:sqlite';
import { assertMemoryNotAborted, ContextMemoryError } from '@print-an-agent/context-memory';
import type { MemorySnapshot, MemoryVersionReference } from '@print-an-agent/context-memory';
import { decodeHistory } from './codec.js';

export function readHistoricalSnapshot(
  database: DatabaseSync,
  reference: MemoryVersionReference,
  signal?: AbortSignal
): MemorySnapshot | undefined {
  try {
    const target = readHistoryRecord(database, reference);
    if (target === undefined) return undefined;
    const baseline = readHistoryBaseline(database, reference);
    let snapshot = decodeHistory(baseline);
    let depth = 0;
    const records = readHistoryRange(
      database,
      reference.memoryId,
      baseline.revision,
      reference.revision
    );
    for (const value of records) {
      assertMemoryNotAborted(signal);
      const row = decodeRow(value);
      if (row.revision !== snapshot.revision + 1 || row.kind !== 'delta')
        throw new Error('History is not contiguous.');
      snapshot = decodeHistory(row, snapshot, depth);
      depth = row.depth;
    }
    if (snapshot.revision !== reference.revision) throw new Error('History target is missing.');
    return snapshot;
  } catch (cause) {
    if (cause instanceof ContextMemoryError && cause.code === 'OPERATION_ABORTED') throw cause;
    throw new ContextMemoryError('HISTORY_CORRUPT', 'Memory history could not be verified.', {
      memoryId: reference.memoryId,
      cause,
    });
  }
}
