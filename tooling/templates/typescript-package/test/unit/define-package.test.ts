import { describe, expect, it } from 'vitest';
import { definePackage } from '../../src/lib/define-package.js';

describe('definePackage', () => {
  it('returns an immutable copy', () => {
    const input = { name: 'example' };
    const result = definePackage(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
  });
});
