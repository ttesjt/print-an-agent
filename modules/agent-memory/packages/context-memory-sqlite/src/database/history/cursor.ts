import { createHash } from 'node:crypto';
import { ContextMemoryError } from '@print-an-agent/context-memory';

const HISTORY_CURSOR_FORMAT = 1;

function cursorHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function unknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function decodeHistoryCursor(
  cursor: string,
  memoryId: string,
  expectedLimit: number,
  currentRevision: number
): { throughRevision: number; before: number } {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!unknownArray(decoded) || decoded.length !== 5) throw new Error('Invalid cursor.');
    const [format, limit, upper, last, checksum] = decoded;
    if (
      format !== HISTORY_CURSOR_FORMAT ||
      limit !== expectedLimit ||
      typeof upper !== 'number' ||
      !Number.isSafeInteger(upper) ||
      upper < 1 ||
      upper > currentRevision ||
      typeof last !== 'number' ||
      !Number.isSafeInteger(last) ||
      last < 1 ||
      last > upper ||
      checksum !== cursorHash(JSON.stringify([memoryId, format, limit, upper, last]))
    )
      throw new Error('Cursor scope mismatch.');
    return { throughRevision: upper, before: last };
  } catch (cause) {
    throw new ContextMemoryError('INPUT_INVALID', 'Invalid history cursor.', {
      memoryId,
      cause,
    });
  }
}

export function encodeHistoryCursor(
  memoryId: string,
  limit: number,
  throughRevision: number,
  last: number
): string {
  const tuple = [HISTORY_CURSOR_FORMAT, limit, throughRevision, last];
  return Buffer.from(
    JSON.stringify([...tuple, cursorHash(JSON.stringify([memoryId, ...tuple]))])
  ).toString('base64url');
}
