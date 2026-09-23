import { describe, expect, it } from 'vitest';
import {
  assertSessionExecutionAllowed,
  assertSessionExecutionLease,
  assertSessionPurgeAllowed,
  assertSessionRecoveryRevision,
  defineSessionExecutionFence,
  normalizeSessionExecutionLease,
  parseSessionId,
  requireSessionMetadataRevision,
  restoreSessionState,
  retireSessionState,
} from '../../src/index.js';
import {
  active,
  captureSessionError,
  idle,
  reference,
  lease,
  mutation,
  retired,
} from '../support/lifecycle-fixtures.js';

describe('Session lifecycle decisions', () => {
  it('retires and restores with shared metadata CAS and the same Session ID', () => {
    const removed = retireSessionState(active, mutation(active), idle, 20);
    expect(removed).toEqual(retired);
    expect(Object.isFrozen(removed)).toBe(true);
    const restored = restoreSessionState(removed, mutation(removed), idle, 30);
    expect(restored).toEqual({ ...active, metadataRevision: 5, metadataUpdatedAt: 30 });
    expect(restored).not.toHaveProperty('retiredAt');
    expect(active.metadataRevision).toBe(3);
  });

  it('rejects repeated state transitions rather than pretending they succeeded', () => {
    expect(
      captureSessionError(() => retireSessionState(retired, mutation(retired), idle, 30))
    ).toMatchObject({ code: 'SESSION_ALREADY_RETIRED' });
    expect(
      captureSessionError(() => restoreSessionState(active, mutation(active), idle, 30))
    ).toMatchObject({ code: 'SESSION_NOT_RETIRED' });
  });

  it.each([
    { ...idle, activeLeaseCount: 1 },
    { ...idle, pendingWorkCount: 1 },
    { ...idle, state: 'recovering' as const },
  ])('blocks all management transitions for busy evidence %j', (fence) => {
    expect(
      captureSessionError(() => retireSessionState(active, mutation(active), fence, 30))
    ).toMatchObject({ code: 'SESSION_BUSY' });
    expect(
      captureSessionError(() => restoreSessionState(retired, mutation(retired), fence, 30))
    ).toMatchObject({ code: 'SESSION_BUSY' });
    expect(
      captureSessionError(() =>
        assertSessionPurgeAllowed(
          retired,
          {
            ...mutation(retired),
            confirmation: 'permanently-delete-session',
          },
          fence
        )
      )
    ).toMatchObject({ code: 'SESSION_BUSY' });
  });

  it('allows purge only with explicit confirmation, correct reference/CAS, retired and idle', () => {
    const input = { ...mutation(retired), confirmation: 'permanently-delete-session' as const };
    expect(() => assertSessionPurgeAllowed(retired, input, idle)).not.toThrow();
    expect(
      captureSessionError(() =>
        assertSessionPurgeAllowed(active, { ...input, expectedRevision: 3 }, idle)
      )
    ).toMatchObject({ code: 'SESSION_NOT_RETIRED' });
    expect(
      captureSessionError(() => assertSessionPurgeAllowed(undefined, input, idle))
    ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('prioritizes absent record, stale reference, CAS, state, then busy', () => {
    const busy = { ...idle, activeLeaseCount: 1 };
    const wrong = { ...mutation(retired), sessionId: parseSessionId('another') };
    expect(captureSessionError(() => retireSessionState(undefined, wrong, busy, 30))).toMatchObject(
      { code: 'SESSION_NOT_FOUND' }
    );
    expect(
      captureSessionError(() =>
        retireSessionState(retired, { ...wrong, expectedRevision: 0 }, busy, 30)
      )
    ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(
      captureSessionError(() => retireSessionState(retired, mutation(active), busy, 30))
    ).toMatchObject({ code: 'SESSION_METADATA_CONFLICT' });
    expect(
      captureSessionError(() => retireSessionState(retired, mutation(retired), busy, 30))
    ).toMatchObject({ code: 'SESSION_ALREADY_RETIRED' });
  });

  it('rejects management writes to a deleted Session', () => {
    expect(
      captureSessionError(() => requireSessionMetadataRevision(undefined, mutation(retired)))
    ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(
      captureSessionError(() => restoreSessionState(undefined, mutation(retired), idle, 30))
    ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(
      captureSessionError(() =>
        assertSessionPurgeAllowed(
          undefined,
          {
            ...mutation(retired),
            confirmation: 'permanently-delete-session',
          },
          idle
        )
      )
    ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, 9])(
    'rejects invalid transition time %s',
    (now) => {
      expect(
        captureSessionError(() => retireSessionState(active, mutation(active), idle, now))
      ).toMatchObject({ code: 'SESSION_LIFECYCLE_INVALID' });
    }
  );

  it('fails closed on metadata revision overflow', () => {
    const exhausted = { ...active, metadataRevision: Number.MAX_SAFE_INTEGER };
    expect(
      captureSessionError(() => retireSessionState(exhausted, mutation(exhausted), idle, 30))
    ).toMatchObject({ code: 'SESSION_LIFECYCLE_INVALID' });
  });
});

describe('Session execution authority decisions', () => {
  const occupied = defineSessionExecutionFence({ ...idle, activeLeaseCount: 1 });

  it('does not serialize independent execution leases or invalidate them on rename', () => {
    expect(() => assertSessionExecutionAllowed(active, reference, occupied)).not.toThrow();
    const renamed = { ...active, metadataRevision: 4, metadataUpdatedAt: 20 };
    expect(() => assertSessionExecutionLease(renamed, lease, lease, occupied)).not.toThrow();
  });

  it('protects replay/output delivery even with no active Turn', () => {
    expect(occupied.pendingWorkCount).toBe(0);
    expect(
      captureSessionError(() => retireSessionState(active, mutation(active), occupied, 20))
    ).toMatchObject({ code: 'SESSION_BUSY' });
    expect(() => retireSessionState(active, mutation(active), idle, 20)).not.toThrow();
  });

  it('rejects execution on retired Sessions and cannot revive a released lease on restore', () => {
    expect(
      captureSessionError(() => assertSessionExecutionLease(retired, lease, lease, occupied))
    ).toMatchObject({ code: 'SESSION_RETIRED' });
    const restored = restoreSessionState(retired, mutation(retired), idle, 30);
    expect(
      captureSessionError(() => assertSessionExecutionLease(restored, lease, undefined, idle))
    ).toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
    const fresh = normalizeSessionExecutionLease({ ...reference, executionId: 'execution-b' });
    expect(
      captureSessionError(() => assertSessionExecutionLease(restored, lease, fresh, occupied))
    ).toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
    expect(() => assertSessionExecutionLease(restored, fresh, fresh, occupied)).not.toThrow();
  });

  it('rejects execution credentials when the Session no longer exists', () => {
    expect(
      captureSessionError(() => assertSessionExecutionLease(undefined, lease, lease, occupied))
    ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
  });

  it('requires the exact Session and owning Agent in registered credentials', () => {
    for (const changes of [{ agentId: 'other' }, { sessionId: 'other' }]) {
      const other = normalizeSessionExecutionLease({ ...lease, ...changes });
      expect(
        captureSessionError(() => assertSessionExecutionLease(active, lease, other, occupied))
      ).toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
    }
  });

  it('keeps incomplete recovery blocked, uses independent CAS, and rejects revoked credentials', () => {
    const recovering = defineSessionExecutionFence({
      ...idle,
      state: 'recovering',
      pendingWorkCount: 1,
    });
    const input = { ...reference, expectedExecutionRevision: recovering.revision };
    expect(() => assertSessionRecoveryRevision(active, input, recovering)).not.toThrow();
    expect(
      captureSessionError(() =>
        assertSessionRecoveryRevision(
          active,
          { ...input, expectedExecutionRevision: 5 },
          recovering
        )
      )
    ).toMatchObject({ code: 'SESSION_EXECUTION_CONFLICT' });
    expect(
      captureSessionError(() => assertSessionExecutionAllowed(active, reference, recovering))
    ).toMatchObject({ code: 'SESSION_BUSY' });
    expect(
      captureSessionError(() => retireSessionState(active, mutation(active), recovering, 20))
    ).toMatchObject({ code: 'SESSION_BUSY' });
    expect(
      captureSessionError(() => assertSessionExecutionLease(active, lease, undefined, idle))
    ).toMatchObject({ code: 'SESSION_EXECUTION_STALE' });
  });
});
