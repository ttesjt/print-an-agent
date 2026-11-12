import type { DatabaseSync } from 'node:sqlite';
import {
  assertMemoryNotAborted,
  canonicalJson,
  ContextMemoryError,
  jsonValue,
  parseMemorySnapshot,
  type MemorySnapshot,
  type MemoryVersionReference,
} from '@print-an-agent/context-memory';
import { decodeHistory, encodeHistory, snapshotDigest, type HistoryRecord } from './codec.js';

function decodeRow(value: unknown): HistoryRecord {
  if (typeof value !== 'object' || value === null) throw new Error('Missing history row.');
  const row = value as Record<string, unknown>;
  if (
    typeof row.memory_id !== 'string' ||
    typeof row.revision !== 'number' ||
    typeof row.format !== 'number' ||
    (row.kind !== 'base' && row.kind !== 'delta') ||
    (row.previous_revision !== null && typeof row.previous_revision !== 'number') ||
    typeof row.depth !== 'number' ||
    typeof row.digest !== 'string' ||
    typeof row.payload_json !== 'string'
  )
    throw new Error('Invalid history row.');
  return {
    memoryId: row.memory_id,
    revision: row.revision,
    format: row.format,
    kind: row.kind,
    previousRevision: row.previous_revision,
    depth: row.depth,
    digest: row.digest,
    payload: row.payload_json,
  };
}
export function readHistoryRecord(
  database: DatabaseSync,
  reference: MemoryVersionReference
): HistoryRecord | undefined {
  const row = database
    .prepare('SELECT * FROM context_memory_history WHERE memory_id = ? AND revision = ?')
    .get(reference.memoryId, reference.revision);
  return row === undefined ? undefined : decodeRow(row);
}
export function writeHistoryRecord(database: DatabaseSync, row: HistoryRecord): void {
  database
    .prepare(
      'INSERT INTO context_memory_history (memory_id, revision, format, kind, previous_revision, depth, digest, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      row.memoryId,
      row.revision,
      row.format,
      row.kind,
      row.previousRevision,
      row.depth,
      row.digest,
      row.payload
    );
}
export function readHistoricalSnapshot(
  database: DatabaseSync,
  reference: MemoryVersionReference,
  signal?: AbortSignal
): MemorySnapshot | undefined {
  try {
    const target = readHistoryRecord(database, reference);
    if (target === undefined) return undefined;
    const baselineValue = database
      .prepare(
        "SELECT * FROM context_memory_history WHERE memory_id = ? AND revision <= ? AND kind = 'base' ORDER BY revision DESC LIMIT 1"
      )
      .get(reference.memoryId, reference.revision);
    const baseline = decodeRow(baselineValue);
    let snapshot = decodeHistory(baseline);
    let depth = 0;
    const records = database
      .prepare(
        'SELECT * FROM context_memory_history WHERE memory_id = ? AND revision > ? AND revision <= ? ORDER BY revision'
      )
      .all(reference.memoryId, baseline.revision, reference.revision);
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

/** Upgrade a legacy current-only store once; never manufacture unavailable ancestor versions. */
export function initializeHistorySchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS context_memory_history_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1), format INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS context_memory_history (
      memory_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK (revision > 0),
      format INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('base', 'delta')),
      previous_revision INTEGER, depth INTEGER NOT NULL CHECK (depth >= 0),
      digest TEXT NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY (memory_id, revision)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS context_memory_history_bases
      ON context_memory_history(memory_id, revision) WHERE kind = 'base';
  `);
  const existing = database
    .prepare('SELECT format FROM context_memory_history_meta WHERE singleton = 1')
    .get();
  if (existing !== undefined) {
    if (existing.format !== 1) throw new Error('Unsupported memory history schema.');
    return;
  }
  for (const row of database
    .prepare('SELECT memory_id, revision, snapshot_json FROM context_memory_documents')
    .all()) {
    if (typeof row.snapshot_json !== 'string') throw new Error('Invalid legacy snapshot.');
    const snapshot = parseMemorySnapshot(JSON.parse(row.snapshot_json));
    if (snapshot.memoryId !== row.memory_id || snapshot.revision !== row.revision)
      throw new Error('Legacy scope mismatch.');
    writeHistoryRecord(database, {
      memoryId: snapshot.memoryId,
      revision: snapshot.revision,
      format: 1,
      kind: 'base',
      previousRevision: null,
      depth: 0,
      digest: snapshotDigest(snapshot),
      payload: canonicalJson(jsonValue(snapshot)),
    });
  }
  database.prepare('INSERT INTO context_memory_history_meta VALUES (1, 1)').run();
}
