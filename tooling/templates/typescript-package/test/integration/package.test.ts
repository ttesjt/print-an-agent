import { describe, expect, it } from 'vitest';
import { definePackage } from '../../src/index.js';

describe('package template', () => {
  it('is usable through its public entry point', () => {
    expect(definePackage({ name: 'integration' })).toEqual({ name: 'integration' });
  });
});
