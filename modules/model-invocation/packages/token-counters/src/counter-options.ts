import { TokenMeasurementError } from '@ta-agent/model-invocation-core';

export function readCounterOptions(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid();
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !allowed.includes(key)) throw invalid();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))
        throw invalid();
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch (cause: unknown) {
    throw new TokenMeasurementError(
      'TOKEN_MEASUREMENT_BINDING_INVALID',
      'Counter options could not be inspected.',
      { cause }
    );
  }
}

function invalid(): TokenMeasurementError {
  return new TokenMeasurementError(
    'TOKEN_MEASUREMENT_BINDING_INVALID',
    'Counter options must be a closed plain record.'
  );
}
