import { describe, expect, it, vi } from 'vitest';
import {
  defineSessionExecutionFence,
  defineSessionLifecycleSnapshot,
  normalizeListRetiredSessionsInput,
  normalizePurgeSessionInput,
  normalizeRecoverSessionExecutionsInput,
  normalizeSessionExecutionLease,
  normalizeSessionLifecycleMutationInput,
  normalizeSessionReference,
  parseSessionExecutionId,
} from '../../../src/index.js';
import {
  active,
  captureSessionError,
  idle,
  lease,
  mutation,
  reference,
  retired,
} from '../../support/lifecycle/fixtures.js';

describe('Session lifecycle input boundaries', () => {
  it('detaches and freezes inputs without manufacturing runtime authority', () => {
    const input = { ...mutation(active) };
    const result = normalizeSessionLifecycleMutationInput(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    input.expectedRevision = 99;
    expect(result.expectedRevision).toBe(3);
    expect(normalizeSessionReference(reference)).toEqual(reference);
    expect(normalizeSessionExecutionLease(lease)).toEqual(lease);
    expect(defineSessionLifecycleSnapshot(retired)).toEqual(retired);
  });

  it.each([
    null,
    [],
    'input',
    1,
    undefined,
    new Date(),
    {},
    { ...mutation(active), extra: true },
    { ...mutation(active), expectedRevision: -1 },
    { ...mutation(active), expectedRevision: 0.5 },
    { ...mutation(active), expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { ...mutation(active), title: 'not-an-identity' },
    { ...mutation(active), sessionId: '../a' },
    { ...mutation(active), agentId: '' },
    { ...mutation(active), [Symbol('hidden')]: true },
  ])('rejects malformed management input %#', (input) => {
    expect(captureSessionError(() => normalizeSessionLifecycleMutationInput(input))).toMatchObject({
      code: 'SESSION_LIFECYCLE_INVALID',
    });
  });

  it('rejects getters, hidden fields and inherited authority without invoking getters', () => {
    const getter = vi.fn(() => 3);
    const accessor = Object.defineProperty({ ...mutation(active) }, 'expectedRevision', {
      get: getter,
      enumerable: true,
    });
    const hidden = Object.defineProperty({ ...mutation(active) }, 'expectedRevision', {
      value: 3,
      enumerable: false,
    });
    const inherited: unknown = Object.create(mutation(active));
    for (const input of [accessor, hidden, inherited]) {
      expect(
        captureSessionError(() => normalizeSessionLifecycleMutationInput(input))
      ).toMatchObject({ code: 'SESSION_LIFECYCLE_INVALID' });
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('maps hostile proxy failures to the stable boundary error', () => {
    const input = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new TypeError('invalid');
        },
      }
    );
    expect(captureSessionError(() => normalizeSessionExecutionLease(input))).toMatchObject({
      code: 'SESSION_EXECUTION_INVALID',
    });
  });

  it.each([
    { ...active, status: 'purged' },
    { ...active, retiredAt: 2 },
    { ...active, status: 'retired' },
    { ...retired, retiredAt: 21 },
    { ...active, metadataRevision: -1 },
    { ...retired, retiredAt: null },
  ])('rejects impossible lifecycle snapshots %#', (input) => {
    expect(captureSessionError(() => defineSessionLifecycleSnapshot(input))).toMatchObject({
      code: 'SESSION_LIFECYCLE_INVALID',
    });
  });

  it('accepts revision zero and timestamp zero without truthiness defaults', () => {
    expect(
      defineSessionLifecycleSnapshot({ ...active, metadataRevision: 0, metadataUpdatedAt: 0 })
    ).toMatchObject({ metadataRevision: 0, metadataUpdatedAt: 0 });
  });

  it.each(['', 'x'.repeat(129), 'with space', '../x', 42, null])(
    'rejects opaque ID %#',
    (input) => {
      expect(() => parseSessionExecutionId(input)).toThrow();
    }
  );

  it('does not require UUIDs or auto-generate IDs at a contract boundary', () => {
    expect(parseSessionExecutionId('execution:42')).toBe('execution:42');
  });

  it('requires exact purge confirmation and uses a distinct input error', () => {
    const input = { ...mutation(retired), confirmation: 'permanently-delete-session' };
    expect(normalizePurgeSessionInput(input)).toEqual(input);
    for (const confirmation of [undefined, true, 'yes', 'purge']) {
      expect(
        captureSessionError(() => normalizePurgeSessionInput({ ...input, confirmation }))
      ).toMatchObject({ code: 'SESSION_PURGE_INVALID' });
    }
  });

  it.each([
    { ...idle, activeLeaseCount: -1 },
    { ...idle, pendingWorkCount: 0.5 },
    { ...idle, revision: Number.POSITIVE_INFINITY },
    { ...idle, state: 'expired' },
    { ...idle, expiresAt: 1 },
  ])('rejects malformed fence evidence %#', (input) => {
    expect(captureSessionError(() => defineSessionExecutionFence(input))).toMatchObject({
      code: 'SESSION_EXECUTION_INVALID',
    });
  });

  it('recovery uses execution revision, not metadata CAS or timeout', () => {
    const input = { ...reference, expectedExecutionRevision: 6 };
    expect(normalizeRecoverSessionExecutionsInput(input)).toEqual(input);
    for (const invalid of [
      mutation(active),
      { ...input, timeoutMs: 5 },
      { ...input, expectedExecutionRevision: -1 },
    ]) {
      expect(
        captureSessionError(() => normalizeRecoverSessionExecutionsInput(invalid))
      ).toMatchObject({ code: 'SESSION_EXECUTION_INVALID' });
    }
  });
});

describe('retired Session query boundary', () => {
  it('supplies bounded defaults and freezes the exclusive cursor', () => {
    expect(normalizeListRetiredSessionsInput({ agentId: reference.agentId })).toEqual({
      agentId: reference.agentId,
      limit: 50,
    });
    const input = {
      agentId: reference.agentId,
      limit: 200,
      cursor: { retiredAt: 20, sessionId: 'conversation' },
    };
    const result = normalizeListRetiredSessionsInput(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result.cursor)).toBe(true);
    input.cursor.retiredAt = 40;
    expect(result.cursor?.retiredAt).toBe(20);
  });

  it.each([
    { limit: 0 },
    { limit: 201 },
    { limit: null },
    { limit: Number.NaN },
    { limit: 1.2 },
    { cursor: null },
    { cursor: { retiredAt: -1, sessionId: 'x' } },
    { cursor: { retiredAt: 1, sessionId: 'x', extra: true } },
    { includeRetired: true },
  ])('rejects unbounded or contradictory query %#', (input) => {
    expect(
      captureSessionError(() =>
        normalizeListRetiredSessionsInput({ agentId: reference.agentId, ...input })
      )
    ).toMatchObject({ code: 'SESSION_QUERY_INVALID' });
  });
});
