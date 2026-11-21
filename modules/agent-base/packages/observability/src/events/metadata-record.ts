import { invalidTraceEvent } from '../errors.js';

/** Copy data descriptors without evaluating caller accessors or retaining mutable input. */
export function snapshotMetadataRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidTraceEvent('Trace metadata must be an object.');
  }
  const snapshot: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    ) {
      invalidTraceEvent('Trace metadata must contain only enumerable string data properties.');
    }
    const field: unknown = descriptor.value;
    Object.defineProperty(snapshot, key, { value: field, enumerable: true });
  }
  return Object.freeze(snapshot);
}
