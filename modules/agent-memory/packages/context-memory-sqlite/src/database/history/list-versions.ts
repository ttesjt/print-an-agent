import { decodeHistoryCursor, encodeHistoryCursor } from './cursor.js';
import type { DatabaseSync } from 'node:sqlite';
import { ContextMemoryError, parseListMemoryVersionsInput } from '@print-an-agent/context-memory';
import type { ListMemoryVersionsInput, MemoryHistoryPage } from '@print-an-agent/context-memory';
import { readSnapshot } from '../persistence/index.js';

/** Cursor integrity is not authorization. The authority and memoryId are always caller-bound. */
export function listHistory(
  database: DatabaseSync,
  value: ListMemoryVersionsInput
): MemoryHistoryPage {
  const input = parseListMemoryVersionsInput(value);
  const current = readSnapshot(database, input.memoryId);
  if (current === undefined)
    throw new ContextMemoryError('MEMORY_NOT_FOUND', 'Memory was not found.', {
      memoryId: input.memoryId,
    });
  let throughRevision = current.revision;
  let before: number | undefined;
  if (input.cursor !== undefined) {
    const position = decodeHistoryCursor(
      input.cursor,
      input.memoryId,
      input.limit,
      current.revision
    );
    throughRevision = position.throughRevision;
    before = position.before;
  }
  const rows =
    before === undefined
      ? database
          .prepare(
            'SELECT revision FROM context_memory_history WHERE memory_id = ? AND revision <= ? ORDER BY revision DESC LIMIT ?'
          )
          .all(input.memoryId, throughRevision, input.limit + 1)
      : database
          .prepare(
            'SELECT revision FROM context_memory_history WHERE memory_id = ? AND revision <= ? AND revision < ? ORDER BY revision DESC LIMIT ?'
          )
          .all(input.memoryId, throughRevision, before, input.limit + 1);
  const versions = rows.slice(0, input.limit).map((row) => {
    if (typeof row.revision !== 'number' || !Number.isSafeInteger(row.revision) || row.revision < 1)
      throw new ContextMemoryError('HISTORY_CORRUPT', 'Invalid history revision.');
    return { memoryId: input.memoryId, revision: row.revision };
  });
  const last = versions.at(-1)?.revision;
  return {
    memoryId: input.memoryId,
    throughRevision,
    versions,
    ...(rows.length > input.limit && last !== undefined
      ? {
          nextCursor: encodeHistoryCursor(input.memoryId, input.limit, throughRevision, last),
        }
      : {}),
  };
}
