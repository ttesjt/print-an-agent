import { expect, it, vi } from 'vitest';
import { defineCompactSessionInput } from '../../src/index.js';

function parseFailure(input: unknown): unknown {
  try {
    defineCompactSessionInput(input);
  } catch (error: unknown) {
    return error;
  }
  throw new Error('Expected invalid compaction input.');
}

it('detaches and freezes normalized IDs and target without freezing caller data', () => {
  const original = { sessionId: 'session', branchId: 'branch', target: { maxTokens: 20 } };
  const normalized = defineCompactSessionInput(original);
  original.target.maxTokens = 30;
  expect(normalized).toEqual({
    sessionId: 'session',
    branchId: 'branch',
    target: { maxTokens: 20 },
  });
  expect(normalized).not.toBe(original);
  expect(normalized.target).not.toBe(original.target);
  expect(Object.isFrozen(normalized)).toBe(true);
  expect(Object.isFrozen(normalized.target)).toBe(true);
  expect(Object.isFrozen(original)).toBe(false);
  expect(
    defineCompactSessionInput({ sessionId: 'session', branchId: undefined, target: undefined })
  ).toEqual({ sessionId: 'session' });
});

it.each([
  { input: { sessionId: '' }, code: 'SESSION_ID_INVALID' },
  { input: { sessionId: 'session', branchId: '' }, code: 'SESSION_BRANCH_ID_INVALID' },
])('retains identifier failure $code', ({ input, code }) => {
  expect(parseFailure(input)).toMatchObject({ code });
});

it('rejects a nested target accessor without executing it', () => {
  const getter = vi.fn(() => 20);
  const target = Object.defineProperty({}, 'maxTokens', { enumerable: true, get: getter });
  expect(parseFailure({ sessionId: 'session', target })).toMatchObject({
    code: 'SESSION_COMPACTION_INVALID',
  });
  expect(getter).not.toHaveBeenCalled();
});
