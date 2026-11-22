import { expect, it } from 'vitest';
import { parseModelOperations, projectModelOperations } from '@print-an-agent/context-memory';
import { errorCode } from '../../support/errors.js';

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
