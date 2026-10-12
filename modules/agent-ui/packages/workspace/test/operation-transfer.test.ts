import { expect, it } from 'vitest';
import { KeyedOperationOwnership } from '../src/testing.js';

it('transfers pending ownership without ending the operation or allowing a second owner', () => {
  const operations = new KeyedOperationOwnership();
  const first = operations.begin('draft');
  expect(operations.move('draft', first, 'session')).toBe(true);
  expect(first.signal.aborted).toBe(false);
  expect(operations.isPending('draft')).toBe(false);
  expect(operations.isCurrent('session', first)).toBe(true);
  expect(operations.beginIfIdle('session')).toBeUndefined();
  operations.complete('draft', first);
  expect(operations.isPending('session')).toBe(true);
  operations.cancel('session', 'Cancel');
  expect(operations.isPending('session')).toBe(true);
  operations.complete('session', first);
  expect(operations.isPending('session')).toBe(false);
});

it('does not transfer stale ownership or steal an occupied target', () => {
  const operations = new KeyedOperationOwnership();
  const first = operations.begin('draft');
  const other = operations.begin('session');
  expect(operations.move('draft', first, 'draft')).toBe(true);
  expect(operations.move('draft', first, 'session')).toBe(false);
  expect(operations.isCurrent('draft', first)).toBe(true);
  expect(operations.isCurrent('session', other)).toBe(true);
  operations.abort('draft', 'Removed');
  expect(operations.move('draft', first, 'unclaimed')).toBe(false);
  expect(operations.isPending('unclaimed')).toBe(false);
  expect(other.signal.aborted).toBe(false);
});
