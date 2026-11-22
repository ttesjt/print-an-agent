import {
  identifier,
  jsonSnapshot,
  RetrievalMemoryError,
  type RetrievalSpace,
} from '@print-an-agent/retrieval-memory';

const ENTRY_ID_ORDER = 'entry-id-utf8-v1';

export function decodeCursor(value: string, memoryId: string, sequence: number): string {
  let cursor: unknown;
  try {
    cursor = jsonSnapshot(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch (cause) {
    throw new RetrievalMemoryError('INPUT_INVALID', 'Invalid pagination cursor.', { cause });
  }
  if (
    typeof cursor !== 'object' ||
    cursor === null ||
    !('memoryId' in cursor) ||
    !('sequence' in cursor) ||
    !('order' in cursor) ||
    !('after' in cursor) ||
    cursor.memoryId !== memoryId ||
    cursor.sequence !== sequence ||
    cursor.order !== ENTRY_ID_ORDER
  )
    throw new RetrievalMemoryError('STALE_CURSOR', 'Cursor scope or published view changed.');
  return identifier(cursor.after);
}

export function encodeCursor(space: RetrievalSpace, after: string): string {
  return Buffer.from(
    JSON.stringify({
      memoryId: space.memoryId,
      sequence: space.sequence,
      order: ENTRY_ID_ORDER,
      after,
    })
  ).toString('base64url');
}
