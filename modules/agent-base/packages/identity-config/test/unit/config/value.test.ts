import { describe, expect, it } from 'vitest';
import {
  AgentConfigError,
  normalizeConfigValue,
} from '@print-an-agent/base-identity-config/config';

describe('Config JSON values', () => {
  it('clones and freezes JSON trees without freezing caller data or rejecting shared references', () => {
    const shared = { enabled: true };
    const input = { entries: [shared, shared], empty: null };
    const result = normalizeConfigValue(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(shared)).toBe(false);
    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result) ||
      !('entries' in result)
    ) {
      throw new Error('Expected normalized object.');
    }
    const entries: unknown = Reflect.get(result, 'entries');
    expect(Object.isFrozen(entries)).toBe(true);
  });

  it.each([
    undefined,
    Number.NaN,
    Infinity,
    1n,
    () => true,
    new Date(),
    { [Symbol('hidden')]: true },
  ])('rejects a value outside the JSON contract: %s', (value) => {
    expect(() => normalizeConfigValue(value)).toThrow(AgentConfigError);
  });

  it('rejects cycles while accepting repeated non-cyclic objects', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => normalizeConfigValue(cyclic)).toThrow('cyclic');
  });

  it('enforces depth and node limits', () => {
    let nested: unknown = 'leaf';
    for (let depth = 0; depth < 64; depth += 1) nested = [nested];
    expect(() => normalizeConfigValue(nested)).not.toThrow();
    expect(() => normalizeConfigValue([nested])).toThrow('nesting');
    expect(() => normalizeConfigValue(Array.from({ length: 100_000 }, () => null))).toThrow(
      'values'
    );
  });

  it('keeps __proto__ as an ordinary own property', () => {
    const input: unknown = JSON.parse('{"__proto__":{"enabled":true}}');
    const result = normalizeConfigValue(input);
    if (typeof result !== 'object' || result === null) throw new Error('Expected object.');
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(result).toEqual(input);
  });
});
