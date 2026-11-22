import type { DatabaseSync } from 'node:sqlite';
import {
  identifier,
  parseRetrievalEntry,
  RetrievalMemoryError,
  type EntryPage,
  type RetrievalBackend,
} from '@print-an-agent/retrieval-memory';
import { SQLITE_RETRIEVAL_LIMITS, assertSqliteLimit } from '../../capabilities.js';
import { requireStoredSpace } from '../persistence/index.js';
import { transaction } from '../transaction.js';
import { encodeCursor, decodeCursor } from './cursor.js';

export function listEntries(
  db: DatabaseSync,
  input: Parameters<RetrievalBackend['list']>[0],
  flag: Int32Array
): EntryPage {
  identifier(input.memoryId);
  assertSqliteLimit(input.limit, SQLITE_RETRIEVAL_LIMITS.maxListLimit);
  return transaction(db, 'read', flag, () => {
    const space = requireStoredSpace(db, input.memoryId);
    const after = input.cursor === undefined ? null : decodeCursor(input.cursor, space);
    const rows = db
      .prepare(
        'SELECT entry_json FROM rm_entries WHERE memory_id=? AND (? IS NULL OR entry_id > ? COLLATE BINARY) ORDER BY entry_id COLLATE BINARY LIMIT ?'
      )
      .all(input.memoryId, after, after, input.limit + 1);
    const entries = rows.slice(0, input.limit).map((row) => {
      if (typeof row.entry_json !== 'string')
        throw new RetrievalMemoryError('STORAGE_FAILED', 'Invalid stored Entry.');
      const entry = parseRetrievalEntry(JSON.parse(row.entry_json));
      return {
        memoryId: entry.memoryId,
        entryId: entry.entryId,
        revision: entry.revision,
        metadata: entry.metadata,
        source: entry.source,
      };
    });
    const last = entries.at(-1);
    return {
      space,
      entries,
      nextCursor:
        rows.length > input.limit && last !== undefined ? encodeCursor(space, last.entryId) : null,
    };
  });
}
