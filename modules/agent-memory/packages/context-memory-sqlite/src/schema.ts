import type { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError } from '@ta-agent/context-memory';
import { initializeHistorySchema } from './history/records.js';

export function initializeMemorySchema(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
  try {
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
    initializeHistorySchema(database);
    database.exec('COMMIT');
  } catch (cause) {
    if (database.isTransaction) {
      try {
        database.exec('ROLLBACK');
      } catch (cleanup) {
        throw new ContextMemoryError('CLEANUP_FAILED', 'History initialization rollback failed.', {
          cause: new AggregateError([cause, cleanup]),
        });
      }
    }
    throw cause;
  }
}
