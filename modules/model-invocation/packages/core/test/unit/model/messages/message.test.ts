import { expect, it } from 'vitest';
import { defineModelMessage } from '../../../../src/index.js';

it('normalizes standalone user/context messages and preserves whitespace', () => {
  for (const role of ['user', 'context']) {
    const input = { role, text: ' facts ', timestamp: 1 };
    const message = defineModelMessage(input);
    expect(message).toEqual(input);
    expect(message).not.toBe(input);
    expect(Object.isFrozen(message)).toBe(true);
  }
});

it('rejects unknown roles, missing fields and accessors without evaluating them', () => {
  for (const input of [
    null,
    { role: 'system', text: 'bad', timestamp: 0 },
    { role: 'user', text: 'hi' },
    { role: 'context', text: 'hi', timestamp: -1 },
    {
      role: 'user',
      get text() {
        throw new Error('not evaluated');
      },
      timestamp: 0,
    },
  ]) {
    expect(() => defineModelMessage(input)).toThrow('Model message');
  }
});
