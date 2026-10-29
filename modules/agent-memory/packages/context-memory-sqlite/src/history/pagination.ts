import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  ContextMemoryError,
  parseListMemoryVersionsInput,
  type ListMemoryVersionsInput,
  type MemoryHistoryPage,
} from '@ta-agent/context-memory';
import { readSnapshot } from '../records.js';

function cursorHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function unknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
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
    try {
      const decoded: unknown = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'));
      if (!unknownArray(decoded) || decoded.length !== 5) throw new Error('Invalid cursor.');
      const [format, limit, upper, last, checksum] = decoded;
      if (
        format !== 1 ||
        limit !== input.limit ||
        typeof upper !== 'number' ||
        !Number.isSafeInteger(upper) ||
        upper < 1 ||
        upper > current.revision ||
        typeof last !== 'number' ||
        !Number.isSafeInteger(last) ||
        last < 1 ||
        last > upper ||
        checksum !== cursorHash(JSON.stringify([input.memoryId, format, limit, upper, last]))
      )
        throw new Error('Cursor scope mismatch.');
      throughRevision = upper;
      before = last;
    } catch (cause) {
      throw new ContextMemoryError('INPUT_INVALID', 'Invalid history cursor.', {
        memoryId: input.memoryId,
        cause,
      });
    }
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
  const tuple = [1, input.limit, throughRevision, last];
  return {
    memoryId: input.memoryId,
    throughRevision,
    versions,
    ...(rows.length > input.limit && last !== undefined
      ? {
          nextCursor: Buffer.from(
            JSON.stringify([...tuple, cursorHash(JSON.stringify([input.memoryId, ...tuple]))])
          ).toString('base64url'),
        }
      : {}),
  };
}
