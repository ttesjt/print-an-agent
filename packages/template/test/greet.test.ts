import { describe, it, expect } from 'vitest';
import { greet } from '../src/lib/index.js';
import { makeOptions } from '../test/fixtures.js';

// Integration tests go here.
// These may hit real I/O, external services, or span multiple modules.

describe('greet (integration)', () => {
  it('produces the expected greeting end-to-end', () => {
    const options = makeOptions({ name: 'integration' });
    expect(greet(options)).toBe('Hello from integration!');
  });
});
