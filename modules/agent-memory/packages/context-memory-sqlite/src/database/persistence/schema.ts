import type { DatabaseSync } from 'node:sqlite';

export function initializeCurrentSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS context_memory_documents (
      memory_id TEXT PRIMARY KEY NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      snapshot_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS context_memory_receipts (
      memory_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      receipt_json TEXT NOT NULL,
      PRIMARY KEY (memory_id, request_id)
    ) STRICT;
    `);
}
