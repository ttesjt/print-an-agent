import type { DatabaseSync } from 'node:sqlite';
import {
  parseRetrievalSpace,
  RetrievalMemoryError,
  type RetrievalSpace,
} from '@print-an-agent/retrieval-memory';
import { decodeJson, encodeJson } from './json.js';

export function readSpace(db: DatabaseSync, memoryId: string): RetrievalSpace | undefined {
  const row = db.prepare('SELECT payload FROM rm_spaces WHERE memory_id=?').get(memoryId);
  return row === undefined ? undefined : parseRetrievalSpace(decodeJson(row.payload));
}
export function requireStoredSpace(db: DatabaseSync, memoryId: string): RetrievalSpace {
  const space = readSpace(db, memoryId);
  if (space === undefined)
    throw new RetrievalMemoryError('MEMORY_NOT_FOUND', 'Memory Space was not found.');
  return space;
}

export function writeSpace(db: DatabaseSync, space: RetrievalSpace): void {
  db.prepare(
    'INSERT INTO rm_spaces VALUES(?,?) ON CONFLICT(memory_id) DO UPDATE SET payload=excluded.payload'
  ).run(space.memoryId, encodeJson(space));
}
