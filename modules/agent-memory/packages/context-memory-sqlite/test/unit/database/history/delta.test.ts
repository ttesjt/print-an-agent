import { expect, it } from 'vitest';

import { jsonValue } from '@print-an-agent/context-memory';
import { diffState } from '../../../../src/database/history/delta/diff.js';
import { applyStateDelta } from '../../../../src/database/history/delta/apply.js';

it('round trips generated nested JSON states, array lengths, text and dangerous property names', () => {
  let seed = 1729;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  let previous = jsonValue({ text: '🎉'.repeat(100), items: [], config: {} });
  for (let index = 0; index < 250; index++) {
    const value = jsonValue({
      text: '🎉'.repeat(100) + String(next()),
      items: Array.from({ length: next() % 9 }, (_, i) => ({
        id: i,
        value: next(),
        meta: { title: '你好\n', values: [null, true, index] },
      })),
      config: index % 2 ? { separator: '\n', maxTokens: null } : {},
    });
    const actual = applyStateDelta(previous, diffState(previous, value));
    expect(actual).toEqual(value);
    expect(previous).not.toBe(actual);
    previous = value;
  }
  const dangerous = jsonValue(JSON.parse('{"__proto__":{"polluted":true},"constructor":"data"}'));
  expect(applyStateDelta({}, diffState({}, dangerous))).toEqual(dangerous);
  expect(Object.prototype).not.toHaveProperty('polluted');
});

it('rejects unknown operations, prototype traversal, missing values and sparse array assignments', () => {
  for (const patch of [
    [{ op: 'set', path: ['__proto__', 'polluted'], value: true }],
    [{ op: 'set', path: ['array', 10], value: true }],
    [{ op: 'set', path: ['x'] }],
    [{ op: 'resize', path: ['array'], length: 99 }],
    [{ op: 'text', path: ['text'], start: 1, deleteCount: 100, text: '' }],
    [{ op: 'bad', path: [] }],
  ])
    expect(() => applyStateDelta({ array: [1], text: 'abc' }, patch)).toThrow();
});
