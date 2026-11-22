import { readSnapshotRows } from '../persistence/index.js';
import { HISTORY_RECORD_FORMAT } from './format.js';
import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, jsonValue, parseMemorySnapshot } from '@print-an-agent/context-memory';
import { snapshotDigest } from './codec.js';
import { writeHistoryRecord } from './records.js';

/** Seed only the available legacy head; never manufacture unavailable ancestor revisions. */
export function upgradeLegacyHistory(database: DatabaseSync): void {
  for (const row of readSnapshotRows(database)) {
    if (typeof row.snapshot_json !== 'string') throw new Error('Invalid legacy snapshot.');
    const snapshot = parseMemorySnapshot(JSON.parse(row.snapshot_json));
    if (snapshot.memoryId !== row.memory_id || snapshot.revision !== row.revision)
      throw new Error('Legacy scope mismatch.');
    writeHistoryRecord(database, {
      memoryId: snapshot.memoryId,
      revision: snapshot.revision,
      format: HISTORY_RECORD_FORMAT,
      kind: 'base',
      previousRevision: null,
      depth: 0,
      digest: snapshotDigest(snapshot),
      payload: canonicalJson(jsonValue(snapshot)),
    });
  }
}
