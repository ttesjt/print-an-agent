import { describe, expect, it } from 'vitest';

import { KeyedOperationOwnership } from '@print-an-agent/ui-workspace/testing';

describe('KeyedOperationOwnership', () => {
  it('acquires exclusive work synchronously and retains the slot through cancellation drainage', () => {
    const ownership = new KeyedOperationOwnership();
    const first = ownership.beginIfIdle('target');
    if (first === undefined) throw new Error('Expected the first operation to acquire its slot.');

    expect(ownership.beginIfIdle('target')).toBeUndefined();
    expect(first.signal.aborted).toBe(false);
    expect(ownership.beginIfIdle('other')).toBeDefined();
    ownership.cancel('target', 'Cancelled by the caller.');
    expect(ownership.beginIfIdle('target')).toBeUndefined();
    ownership.complete('target', first);
    expect(ownership.beginIfIdle('target')).toBeDefined();
  });

  it('supersedes work only within the same target key', () => {
    const ownership = new KeyedOperationOwnership();
    const first = ownership.begin('first');
    const second = ownership.begin('second');
    const replacement = ownership.begin('first');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(ownership.isCurrent('first', replacement)).toBe(true);
    expect(ownership.isCurrent('second', second)).toBe(true);
  });

  it('keeps a cancelled operation authoritative until its consumer drains it', () => {
    const ownership = new KeyedOperationOwnership();
    const operation = ownership.begin('target');

    ownership.cancel('target', 'Cancelled by the caller.');

    expect(operation.signal.aborted).toBe(true);
    expect(ownership.isCurrent('target', operation)).toBe(true);
    ownership.complete('target', operation);
    expect(ownership.isCurrent('target', operation)).toBe(false);
  });

  it('aborts every owned operation during application cleanup', () => {
    const ownership = new KeyedOperationOwnership();
    const first = ownership.begin('first');
    const second = ownership.begin('second');

    ownership.abortAll('Application unmounted.');

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(ownership.isCurrent('first', first)).toBe(false);
    expect(ownership.isCurrent('second', second)).toBe(false);
  });
});
