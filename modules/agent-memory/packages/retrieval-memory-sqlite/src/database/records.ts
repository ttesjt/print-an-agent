import type { DatabaseSync } from 'node:sqlite';
import {
  parseRetrievalSpace,
  parseStoredEntry,
  parseRetrievalReceipt,
  RetrievalMemoryError,
  type RetrievalSpace,
} from '@ta-agent/retrieval-memory';
function payload(value: unknown): unknown {
  if (typeof value !== 'string')
    throw new RetrievalMemoryError('STORAGE_FAILED', 'Invalid persisted JSON payload.');
  return JSON.parse(value) as unknown;
}
export function readSpace(db: DatabaseSync, memoryId: string) {
  const row = db.prepare('SELECT payload FROM rm_spaces WHERE memory_id=?').get(memoryId);
  return row === undefined ? undefined : parseRetrievalSpace(payload(row.payload));
}
export function requireStoredSpace(db: DatabaseSync, memoryId: string): RetrievalSpace {
  const space = readSpace(db, memoryId);
  if (space === undefined)
    throw new RetrievalMemoryError('MEMORY_NOT_FOUND', 'Memory Space was not found.');
  return space;
}
export function readEntry(
  db: DatabaseSync,
  memoryId: string,
  entryId: string,
  space = readSpace(db, memoryId)
) {
  if (space === undefined) return undefined;
  const row = db
    .prepare(
      'SELECT entry_json, representation_json FROM rm_entries WHERE memory_id=? AND entry_id=?'
    )
    .get(memoryId, entryId);
  return row === undefined
    ? undefined
    : parseStoredEntry(
        { entry: payload(row.entry_json), representation: payload(row.representation_json) },
        space
      );
}
export function readReceipt(db: DatabaseSync, memoryId: string, requestId: string) {
  const row = db
    .prepare('SELECT payload FROM rm_receipts WHERE memory_id=? AND request_id=?')
    .get(memoryId, requestId);
  return row === undefined ? undefined : parseRetrievalReceipt(payload(row.payload));
}
export function encode(value: unknown): string {
  return JSON.stringify(value);
}
