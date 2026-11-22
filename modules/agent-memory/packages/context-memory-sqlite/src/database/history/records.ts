import { isHistoryRecordKind } from './format.js';
import type { DatabaseSync } from 'node:sqlite';
import type { MemoryVersionReference } from '@print-an-agent/context-memory';
import type { HistoryRecord } from './types/record.js';

export function decodeRow(value: unknown): HistoryRecord {
  if (typeof value !== 'object' || value === null) throw new Error('Missing history row.');
  const row = value as Record<string, unknown>;
  if (
    typeof row.memory_id !== 'string' ||
    typeof row.revision !== 'number' ||
    typeof row.format !== 'number' ||
    !isHistoryRecordKind(row.kind) ||
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

export function readHistoryBaseline(
  database: DatabaseSync,
  reference: MemoryVersionReference
): HistoryRecord {
  const row = database
    .prepare(
      "SELECT * FROM context_memory_history WHERE memory_id = ? AND revision <= ? AND kind = 'base' ORDER BY revision DESC LIMIT 1"
    )
    .get(reference.memoryId, reference.revision);
  return decodeRow(row);
}

export function readHistoryRange(
  database: DatabaseSync,
  memoryId: string,
  fromRevision: number,
  throughRevision: number
): readonly unknown[] {
  return database
    .prepare(
      'SELECT * FROM context_memory_history WHERE memory_id = ? AND revision > ? AND revision <= ? ORDER BY revision'
    )
    .all(memoryId, fromRevision, throughRevision);
}
