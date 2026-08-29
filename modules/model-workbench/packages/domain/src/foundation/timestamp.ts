import { InvalidWorkbenchValueError } from './errors.js';

declare const timestampBrand: unique symbol;

export type Timestamp = string & { readonly [timestampBrand]: 'Timestamp' };

export function parseTimestamp(input: unknown, path = 'timestamp'): Timestamp {
  if (typeof input !== 'string') {
    throw new InvalidWorkbenchValueError(path, 'must be an ISO 8601 UTC timestamp');
  }

  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== input) {
    throw new InvalidWorkbenchValueError(path, 'must be an ISO 8601 UTC timestamp');
  }
  return input as Timestamp;
}
