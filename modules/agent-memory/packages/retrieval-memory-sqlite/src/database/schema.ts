import { DatabaseSync } from 'node:sqlite';
import { load } from 'sqlite-vec';
import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';
import type { WorkerConfiguration } from '../protocol.js';
import { SQLITE_RETRIEVAL_LIMITS } from '../capabilities.js';
export { SQLITE_RETRIEVAL_LIMITS } from '../capabilities.js';
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
export function openDatabase(config: WorkerConfiguration): DatabaseSync {
  const db = new DatabaseSync(config.path, { allowExtension: true, timeout: config.busyTimeoutMs });
  try {
    load(db);
    db.enableLoadExtension(false);
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS rm_spaces(memory_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rm_entries(memory_id TEXT NOT NULL, entry_id TEXT NOT NULL, entry_json TEXT NOT NULL, representation_json TEXT NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY(memory_id,entry_id), FOREIGN KEY(memory_id) REFERENCES rm_spaces(memory_id));
      CREATE TABLE IF NOT EXISTS rm_chunks(row_id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, entry_id TEXT NOT NULL, chunk_json TEXT NOT NULL, vector BLOB NOT NULL, FOREIGN KEY(memory_id,entry_id) REFERENCES rm_entries(memory_id,entry_id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS rm_chunk_scope ON rm_chunks(memory_id,entry_id);
      CREATE INDEX IF NOT EXISTS rm_metadata_scan ON rm_entries(memory_id,metadata_json,entry_id);
      CREATE TABLE IF NOT EXISTS rm_receipts(memory_id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(memory_id,request_id));`);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch (cleanup) {
      throw new AggregateError([cause, cleanup], 'SQLite initialization and cleanup failed.');
    }
    throw cause;
  }
}
export function ensureVectorTable(db: DatabaseSync, dimensions: number): void {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${vectorTable(dimensions)} USING vec0(row_id INTEGER PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine, memory_id TEXT PARTITION KEY, generation_id TEXT PARTITION KEY)`
  );
}
