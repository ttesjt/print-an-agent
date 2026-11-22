import type { DatabaseSync } from 'node:sqlite';
import { RetrievalMemoryError, type RetrievalSpace } from '@print-an-agent/retrieval-memory';
import { SQLITE_RETRIEVAL_LIMITS } from '../capabilities.js';

export function vectorTable(dimensions: number): string {
  if (
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    dimensions > SQLITE_RETRIEVAL_LIMITS.maxDimensions
  )
    throw new RetrievalMemoryError(
      'UNSUPPORTED_CAPABILITY',
      'Embedding dimensions exceed this SQLite backend capability.'
    );
  return `rm_vectors_${dimensions}`; // Only a validated integer is interpolated, never an external identity.
}
export function ensureVectorTable(db: DatabaseSync, dimensions: number): void {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${vectorTable(dimensions)} USING vec0(row_id INTEGER PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine, memory_id TEXT PARTITION KEY, generation_id TEXT PARTITION KEY)`
  );
}

export function removeVectors(
  db: DatabaseSync,
  dimensions: number,
  rowIds: readonly bigint[]
): void {
  const table = vectorTable(dimensions);
  for (const rowId of rowIds) db.prepare(`DELETE FROM ${table} WHERE row_id=?`).run(rowId);
}

export function createVectorInsert(
  db: DatabaseSync,
  space: RetrievalSpace
): (rowId: number | bigint, binary: Float32Array) => void {
  const insert = db.prepare(
    `INSERT INTO ${vectorTable(space.index.dimensions)}(row_id,embedding,memory_id,generation_id) VALUES(?,?,?,?)`
  );
  return (rowId, binary) => {
    insert.run(BigInt(rowId), binary, space.memoryId, space.index.generationId);
  };
}
