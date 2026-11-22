import type { DatabaseSync } from 'node:sqlite';
import { parseMemorySnapshot } from '@print-an-agent/context-memory';
import type { MemorySnapshot } from '@print-an-agent/context-memory';
import { storedRecord } from './decode-record.js';

export function readSnapshot(database: DatabaseSync, memoryId: string): MemorySnapshot | undefined {
  return storedRecord(memoryId, () => {
    const row = database
      .prepare('SELECT revision, snapshot_json FROM context_memory_documents WHERE memory_id = ?')
      .get(memoryId);
    if (row === undefined) return undefined;
    if (typeof row.snapshot_json !== 'string') throw new Error('Invalid stored snapshot encoding.');
    const value: unknown = JSON.parse(row.snapshot_json);
    const snapshot = parseMemorySnapshot(value);
    if (snapshot.memoryId !== memoryId || snapshot.revision !== row.revision)
      throw new Error('Stored snapshot scope/revision mismatch.');
    return snapshot;
  });
}

export function writeSnapshot(database: DatabaseSync, snapshot: MemorySnapshot): void {
  database
    .prepare(
      `INSERT INTO context_memory_documents (memory_id, revision, snapshot_json) VALUES (?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET revision = excluded.revision, snapshot_json = excluded.snapshot_json`
    )
    .run(snapshot.memoryId, snapshot.revision, JSON.stringify(snapshot));
}

/** Raw current rows used only by the one-time adapter-owned history upgrade. */
export function readSnapshotRows(database: DatabaseSync): readonly Record<string, unknown>[] {
  return database
    .prepare('SELECT memory_id, revision, snapshot_json FROM context_memory_documents')
    .all();
}
