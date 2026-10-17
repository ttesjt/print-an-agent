import { expect, it } from 'vitest';
import {
  canonicalJson,
  ContextMemoryError,
  jsonValue,
  parseItemCommands,
  parseItemContent,
  parseModelOperations,
  projectModelOperations,
} from '@ta-agent/context-memory';
import { errorCode } from './support/errors.js';

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

it('the model returns operations, not an updated state, metadata or invented add identities', () => {
  expect(parseModelOperations('[{"op":"replace","itemId":"a","content":"short"}]')).toEqual([
    { op: 'replace', itemId: 'a', content: 'short' },
  ]);
  for (const text of [
    '{"items":[]}',
    '[{"id":"a","content":"state"}]',
    '[{"op":"add","id":"x","content":"x"}]',
    '[{"op":"add","content":"x","metadata":{}}]',
    '```json\n[]\n```',
  ]) {
    expect(errorCode(() => parseModelOperations(text))).toBe('MODEL_OUTPUT_INVALID');
  }
});
it('projects content-only model edits without silently wiping metadata', () => {
  const metadata = { source: 'user' };
  expect(
    projectModelOperations(
      [{ id: 'a', content: 'old', metadata }],
      [{ op: 'replace', itemId: 'a', content: 'new' }]
    )
  ).toEqual([{ op: 'replace', itemId: 'a', content: 'new', metadata }]);
  expect(
    errorCode(() => projectModelOperations([], [{ op: 'replace', itemId: 'a', content: 'new' }]))
  ).toBe('ITEM_NOT_FOUND');
});
