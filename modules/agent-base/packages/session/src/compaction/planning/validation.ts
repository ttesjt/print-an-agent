import { AgentSessionError } from '../../errors.js';

export function compactionRecord(
  value: unknown,
  allowed: readonly string[],
  label: string
): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentSessionError('SESSION_COMPACTION_INVALID', `${label} must be a plain object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new AgentSessionError('SESSION_COMPACTION_INVALID', `${label} must be a plain object.`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !allowed.includes(key) ||
      property === undefined ||
      !property.enumerable ||
      !('value' in property)
    ) {
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
