import type { DatabaseSync } from 'node:sqlite';
import {
  ContextMemoryError,
  parseMemorySnapshot,
  parseMemoryReceipt,
  type MemorySnapshot,
  type MemoryReceipt,
} from '@ta-agent/context-memory';

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
export function readReceipt(
  database: DatabaseSync,
  memoryId: string,
  requestId: string
): MemoryReceipt | undefined {
  return storedRecord(memoryId, () => {
    const row = database
      .prepare(
        'SELECT receipt_json FROM context_memory_receipts WHERE memory_id = ? AND request_id = ?'
      )
      .get(memoryId, requestId);
    if (row === undefined) return undefined;
    if (typeof row.receipt_json !== 'string') throw new Error('Invalid stored receipt encoding.');
    const value: unknown = JSON.parse(row.receipt_json);
    const receipt = parseMemoryReceipt(value);
    if (receipt.memoryId !== memoryId || receipt.requestId !== requestId)
      throw new Error('Stored receipt scope mismatch.');
    return receipt;
  });
}
function storedRecord<T>(memoryId: string, read: () => T): T {
  try {
    return read();
  } catch (cause) {
    throw new ContextMemoryError(
      'STORAGE_FAILED',
      'Stored memory authority could not be decoded.',
      {
        memoryId,
        cause,
      }
    );
  }
}
export function writeSnapshot(database: DatabaseSync, snapshot: MemorySnapshot): void {
  database
    .prepare(
      `INSERT INTO context_memory_documents (memory_id, revision, snapshot_json) VALUES (?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET revision = excluded.revision, snapshot_json = excluded.snapshot_json`
    )
    .run(snapshot.memoryId, snapshot.revision, JSON.stringify(snapshot));
}
export function writeReceipt(database: DatabaseSync, receipt: MemoryReceipt): void {
  database
    .prepare(
      'INSERT INTO context_memory_receipts (memory_id, request_id, receipt_json) VALUES (?, ?, ?)'
    )
    .run(receipt.memoryId, receipt.requestId, JSON.stringify(receipt));
}
