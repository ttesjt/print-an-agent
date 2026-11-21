type ModelRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is ModelRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural reads are shared; the caller owns its error code and domain-specific description. */
export function readPlainModelRecord(
  value: unknown,
  label: string,
  invalid: (message: string) => Error,
  description = 'plain object'
): ModelRecord {
  if (!isRecord(value)) throw invalid(`${label} must be a ${description}.`);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw invalid(`${label} must be a ${description}.`);
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw invalid(`${label} cannot contain symbol properties.`);
  return value;
}

export function assertModelRecordKeys(
  record: ModelRecord,
  expected: readonly string[],
  invalid: () => Error
): void {
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw invalid();
}

export function readModelDataField(
  record: ModelRecord,
  key: string,
  invalid: () => Error
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))
    throw invalid();
  return descriptor.value;
}
