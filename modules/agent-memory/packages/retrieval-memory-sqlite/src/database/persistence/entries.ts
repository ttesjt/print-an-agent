import type { DatabaseSync } from 'node:sqlite';
import {
  parseStoredEntry,
  type RetrievalSpace,
  type StoredEntry,
  type RetrievalEntry,
  type RetrievalChunk,
} from '@print-an-agent/retrieval-memory';
import { decodeJson, decodeObject, encodeJson } from './json.js';
import { readSpace } from './spaces.js';
import { decodeVector } from '../vector-codec.js';

export function readEntry(
  db: DatabaseSync,
  memoryId: string,
  entryId: string,
  space: RetrievalSpace | undefined = readSpace(db, memoryId)
): StoredEntry | undefined {
  if (space === undefined) return undefined;
  const row = db
    .prepare(
      'SELECT entry_json, representation_json FROM rm_entries WHERE memory_id=? AND entry_id=?'
    )
    .get(memoryId, entryId);
  if (row === undefined) return undefined;
  const chunks = db
    .prepare(
      "SELECT chunk_json,vector FROM rm_chunks WHERE memory_id=? AND entry_id=? ORDER BY json_extract(chunk_json,'$.ordinal')"
    )
    .all(memoryId, entryId)
    .map((row) => ({
      ...decodeObject(row.chunk_json),
      vector: decodeVector(row.vector, space.index.dimensions),
    }));
  return parseStoredEntry(
    {
      entry: decodeJson(row.entry_json),
      representation: { ...decodeObject(row.representation_json), chunks },
    },
    space
  );
}

export function entryChunkRowIds(
  db: DatabaseSync,
  memoryId: string,
  entryId: string
): readonly bigint[] {
  return db
    .prepare('SELECT row_id FROM rm_chunks WHERE memory_id=? AND entry_id=?')
    .all(memoryId, entryId)
    .map((row) => BigInt(String(row.row_id)));
}
export function deleteEntry(db: DatabaseSync, memoryId: string, entryId: string): void {
  db.prepare('DELETE FROM rm_entries WHERE memory_id=? AND entry_id=?').run(memoryId, entryId);
}
export function writeEntryHeader(
  db: DatabaseSync,
  entry: RetrievalEntry,
  header: Omit<StoredEntry['representation'], 'chunks'>
): void {
  db.prepare('INSERT INTO rm_entries VALUES(?,?,?,?,?)').run(
    entry.memoryId,
    entry.entryId,
    encodeJson(entry),
    encodeJson(header),
    encodeJson(entry.metadata)
  );
}
export function createChunkInsert(
  db: DatabaseSync,
  memoryId: string,
  entryId: string
): (chunk: Omit<RetrievalChunk, 'vector'>, binary: Float32Array) => number | bigint {
  const insert = db.prepare(
    'INSERT INTO rm_chunks(memory_id,entry_id,chunk_json,vector) VALUES(?,?,?,?)'
  );
  return (chunk, binary) =>
    insert.run(memoryId, entryId, encodeJson(chunk), binary).lastInsertRowid;
}
