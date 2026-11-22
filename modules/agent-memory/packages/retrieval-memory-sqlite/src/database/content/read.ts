import type { DatabaseSync } from 'node:sqlite';
import type { StoredEntry } from '@print-an-agent/retrieval-memory';
import { readEntry } from '../persistence/index.js';
import { transaction } from '../transaction.js';

/** The Entry/header/chunk hydration observes one published view. */
export function getEntry(
  db: DatabaseSync,
  memoryId: string,
  entryId: string,
  flag: Int32Array
): StoredEntry | undefined {
  return transaction(db, 'read', flag, () => readEntry(db, memoryId, entryId));
}
