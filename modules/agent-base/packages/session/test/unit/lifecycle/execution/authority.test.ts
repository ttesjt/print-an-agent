import { describe, expect, it } from 'vitest';
import {
  assertSessionExecutionAllowed,
  assertSessionExecutionLease,
  assertSessionRecoveryRevision,
  defineSessionExecutionFence,
  normalizeSessionExecutionLease,
  restoreSessionState,
  retireSessionState,
} from '../../../../src/index.js';
import {
  active,
  captureSessionError,
  idle,
  lease,
  mutation,
  reference,
  retired,
} from '../../../support/lifecycle/fixtures.js';

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
