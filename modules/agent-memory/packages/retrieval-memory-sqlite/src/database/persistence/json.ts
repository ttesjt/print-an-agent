import { RetrievalMemoryError } from '@print-an-agent/retrieval-memory';

export function decodeJson(value: unknown): unknown {
  if (typeof value !== 'string')
    throw new RetrievalMemoryError('STORAGE_FAILED', 'Invalid persisted JSON payload.');
  return JSON.parse(value) as unknown;
}
export function decodeObject(value: unknown): Record<string, unknown> {
  const result = decodeJson(value);
  if (typeof result !== 'object' || result === null || Array.isArray(result))
    throw new RetrievalMemoryError('STORAGE_FAILED', 'Expected a stored JSON object.');
  return result as Record<string, unknown>;
}
export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}
