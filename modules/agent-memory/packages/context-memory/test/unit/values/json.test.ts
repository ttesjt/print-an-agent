import { expect, it } from 'vitest';
import { canonicalJson, ContextMemoryError, jsonValue } from '@print-an-agent/context-memory';

it.each([undefined, NaN, Infinity, new Date(), { bad: undefined }, Array<unknown>(2)])(
  'rejects non-JSON value %s',
  (value) => {
    expect(() => jsonValue(value)).toThrow(ContextMemoryError);
  }
);

it('rejects cycles and accessors without executing them, and canonicalizes object key order', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  expect(() => jsonValue(cyclic)).toThrow();
  let called = false;
  const array: unknown[] = ['x'];
  Object.defineProperty(array, '0', {
    enumerable: true,
    get() {
      called = true;
      return 'x';
    },
  });
  expect(() => jsonValue(array)).toThrow();
  expect(called).toBe(false);
  expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe(
    canonicalJson({ a: { x: 3, y: 2 }, z: 1 })
  );
});
