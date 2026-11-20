import { AgentSessionError } from '../errors.js';
import { enumerableDataProperty, isPlainRecord } from '../validation/data-record.js';

export function compactionRecord(
  value: unknown,
  allowed: readonly string[],
  label: string
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw new AgentSessionError('SESSION_COMPACTION_INVALID', `${label} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const property = enumerableDataProperty(value, key);
    if (typeof key !== 'string' || !allowed.includes(key) || property === undefined) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_INVALID',
        `${label} contains an unsupported field or accessor.`
      );
    }
  }
  return value as Readonly<Record<string, unknown>>;
}

export function compactionInteger(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      `${label} must be a safe integer no smaller than ${minimum}.`
    );
  }
  return value;
}

export function compactionRatio(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1) {
    throw new AgentSessionError('SESSION_COMPACTION_INVALID', `${label} must be > 0 and <= 1.`);
  }
  return value;
}
