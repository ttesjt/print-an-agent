import { expect, it } from 'vitest';
import {
  ContextMemoryError,
  parseItemCommands,
  parseItemContent,
  applyItemCommands,
} from '@print-an-agent/context-memory';
import { errorCode } from '../../support/errors.js';

it('accepts short, empty and multiline input but does not accept a caller-selected add ID', () => {
  expect(parseItemContent({ content: '' })).toEqual({ content: '' });
  expect(parseItemCommands([{ op: 'add', content: ' x\n' }])).toEqual([
    { op: 'add', content: ' x\n' },
  ]);
  expect(() => parseItemCommands([{ op: 'add', id: 'mine', content: 'x' }])).toThrow(
    ContextMemoryError
  );
  expect(() => parseItemContent({ metadata: {} })).toThrow(ContextMemoryError);
  expect(() =>
    parseItemCommands([
      { op: 'replace', itemId: 'a', content: '' },
      { op: 'remove', itemId: 'a' },
    ])
  ).toThrow(ContextMemoryError);
});

it('normalizes empty commands atomically, preserves order, and replaces whole metadata', () => {
  let allocations = 0;
  const original = [
    { id: 'a', content: 'original', metadata: { a: 1 } },
    { id: 'b', content: 'keep' },
  ];
  const result = applyItemCommands(
    original,
    [
      { op: 'add', content: '\n ' },
      { op: 'replace', itemId: 'a', content: '\t' },
      { op: 'replace', itemId: 'b', content: ' keep\n' },
      { op: 'add', content: 'new' },
    ],
    () => {
      allocations++;
      return 'c';
    }
  );
  expect(result.items).toEqual([
    { id: 'b', content: ' keep\n' },
    { id: 'c', content: 'new' },
  ]);
  expect(result.commandOutcomes.map((entry) => entry.outcome)).toEqual([
    'ignored',
    'removed',
    'updated',
    'added',
  ]);
  expect(allocations).toBe(1);
  expect(original[0]?.content).toBe('original');
  expect(
    applyItemCommands(original, [{ op: 'replace', itemId: 'a', content: 'original' }]).items[0]
  ).toEqual({ id: 'a', content: 'original' });
  expect(
    errorCode(() =>
      applyItemCommands(
        original,
        [
          { op: 'add', content: 'x' },
          { op: 'replace', itemId: 'missing', content: '' },
        ],
        () => {
          allocations++;
          return 'd';
        }
      )
    )
  ).toBe('ITEM_NOT_FOUND');
  expect(allocations).toBe(1);
  expect(
    errorCode(() => applyItemCommands(original, [{ op: 'add', content: 'x' }], () => 'a'))
  ).toBe('INPUT_INVALID');
});
