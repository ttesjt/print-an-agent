import { describe, expect, it } from 'vitest';
import { composeExecutionSignal } from '@print-an-agent/workflow-core';

describe('execution cancellation composition', () => {
  it('returns one source directly and removes duplicate source identities', () => {
    const source = new AbortController().signal;

    expect(composeExecutionSignal([source])).toBe(source);
    expect(composeExecutionSignal([source, source])).toBe(source);
  });

  it('uses source order as deterministic precedence for already-aborted signals', () => {
    const first = AbortSignal.abort(new Error('first'));
    const second = AbortSignal.abort(new Error('second'));

    expect(composeExecutionSignal([first, second]).reason).toBe(first.reason);
    expect(composeExecutionSignal([second, first]).reason).toBe(second.reason);
  });

  it('preserves the first live cancellation without aborting any source', () => {
    const first = new AbortController();
    const second = new AbortController();
    const firstFailure = new Error('first');
    const secondFailure = new Error('second');
    const effective = composeExecutionSignal([first.signal, second.signal]);

    second.abort(secondFailure);
    first.abort(firstFailure);

    expect(effective.aborted).toBe(true);
    expect(effective.reason).toBe(secondFailure);
    expect(first.signal.reason).toBe(firstFailure);
    expect(second.signal.reason).toBe(secondFailure);
  });
});
