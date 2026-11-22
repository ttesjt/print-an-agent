import { initializeCurrentSchema } from './persistence/index.js';
import type { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError } from '@print-an-agent/context-memory';
import { initializeHistorySchema } from './history/index.js';

export function initializeMemorySchema(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    initializeCurrentSchema(database);
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
