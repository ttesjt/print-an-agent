/** Structural checks only. Each domain owns required fields and its error semantics. */
export function isPlainRecord(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** Read the descriptor without invoking an untrusted accessor. Absence differs from undefined. */
export function enumerableDataProperty(
  input: object,
  key: PropertyKey
): Readonly<{ value: unknown }> | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
    return undefined;
  return { value: descriptor.value as unknown };
}
