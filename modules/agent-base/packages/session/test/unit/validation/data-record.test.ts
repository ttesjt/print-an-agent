import { expect, it, vi } from 'vitest';
import { enumerableDataProperty, isPlainRecord } from '../../../src/validation/data-record.js';

it('accepts plain and null-prototype records while rejecting other object shapes', () => {
  expect(isPlainRecord({})).toBe(true);
  expect(isPlainRecord(Object.create(null))).toBe(true);
  for (const value of [undefined, null, false, 1, 'record', [], new Date(), Object.create({})]) {
    expect(isPlainRecord(value)).toBe(false);
  }
});

it('distinguishes an own undefined value from missing, hidden and inherited fields', () => {
  const input = Object.defineProperty({ value: undefined }, 'hidden', { value: 1 });
  expect(enumerableDataProperty(input, 'value')).toEqual({ value: undefined });
  expect(enumerableDataProperty(input, 'missing')).toBeUndefined();
  expect(enumerableDataProperty(input, 'hidden')).toBeUndefined();
  const inherited = {};
  Object.setPrototypeOf(inherited, { value: 1 });
  expect(enumerableDataProperty(inherited, 'value')).toBeUndefined();
  expect(enumerableDataProperty(['text'], '0')).toEqual({ value: 'text' });
});

it('rejects accessors without executing them and preserves structural trap failures', () => {
  const getter = vi.fn(() => 'untrusted');
  const input = Object.defineProperty({}, 'value', { enumerable: true, get: getter });
  expect(enumerableDataProperty(input, 'value')).toBeUndefined();
  expect(getter).not.toHaveBeenCalled();
  const failure = new Error('descriptor lookup failed');
  const proxy = new Proxy(
    {},
    {
      getOwnPropertyDescriptor: () => {
        throw failure;
      },
    }
  );
  expect(() => enumerableDataProperty(proxy, 'value')).toThrow(failure);
});
