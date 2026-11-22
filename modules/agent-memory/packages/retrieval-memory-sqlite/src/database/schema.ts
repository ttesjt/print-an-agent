import type { DatabaseSync } from 'node:sqlite';

export function initializeSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS rm_spaces(memory_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rm_entries(memory_id TEXT NOT NULL, entry_id TEXT NOT NULL, entry_json TEXT NOT NULL, representation_json TEXT NOT NULL, metadata_json TEXT NOT NULL, PRIMARY KEY(memory_id,entry_id), FOREIGN KEY(memory_id) REFERENCES rm_spaces(memory_id));
      CREATE TABLE IF NOT EXISTS rm_chunks(row_id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, entry_id TEXT NOT NULL, chunk_json TEXT NOT NULL, vector BLOB NOT NULL, FOREIGN KEY(memory_id,entry_id) REFERENCES rm_entries(memory_id,entry_id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS rm_chunk_scope ON rm_chunks(memory_id,entry_id);
      CREATE INDEX IF NOT EXISTS rm_metadata_scan ON rm_entries(memory_id,metadata_json,entry_id);
      CREATE TABLE IF NOT EXISTS rm_receipts(memory_id TEXT NOT NULL, request_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(memory_id,request_id));`);
}
