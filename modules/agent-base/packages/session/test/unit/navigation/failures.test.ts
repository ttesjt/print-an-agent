import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  executeSessionNavigation,
} from '../../../src/index.js';
import {
  agentId,
  createAppliedNavigation,
  createExecutionLease,
  createSnapshot,
  sessionId,
} from '../../support/navigation/coordinator-fixtures.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

describe('Session navigation coordinator failures', () => {
  it('releases mutation authority when adapter mutation fails', async () => {
    const lease = createExecutionLease();
    const mutationFailure = new AgentSessionError(
      'SESSION_NAVIGATION_CONFLICT',
      'Navigation revision conflict.'
    );
    const release = vi.fn(() => Promise.resolve());
    const session = Object.freeze({
      ...createSessionPortStub({
        inspect: () => Promise.resolve(createSnapshot()),
        applyNavigation: () => Promise.reject(mutationFailure),
      }),
      acquireSessionExecution: () => Promise.resolve(lease),
      releaseSessionExecution: release,
    });

    await expect(
      executeSessionNavigation({
        agentId,
        navigation: {
          sessionId,
          operation: 'select',
          branchId: DEFAULT_SESSION_BRANCH_ID,
          expectedRevision: 0,
        },
        session,
      })
    ).rejects.toBe(mutationFailure);
    expect(release).toHaveBeenCalledWith(lease);
  });

  it('releases mutation authority when the Session does not exist', async () => {
    const lease = createExecutionLease();
    const release = vi.fn(() => Promise.resolve());
    const applyNavigation = vi.fn(() => Promise.resolve(createAppliedNavigation()));
    const session = Object.freeze({
      ...createSessionPortStub({
        inspect: () => Promise.resolve(undefined),
        applyNavigation,
      }),
      acquireSessionExecution: () => Promise.resolve(lease),
      releaseSessionExecution: release,
    });

    await expect(
      executeSessionNavigation({
        agentId,
        navigation: {
          sessionId,
          operation: 'select',
          branchId: DEFAULT_SESSION_BRANCH_ID,
          expectedRevision: 0,
        },
        session,
      })
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(applyNavigation).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(lease);
  });

  it('retains both the operation and cleanup failure when release also fails', async () => {
    const mutationFailure = new AgentSessionError(
      'SESSION_NAVIGATION_CONFLICT',
      'Navigation revision conflict.'
    );
    const releaseFailure = new AgentSessionError(
      'SESSION_STORAGE_FAILED',
      'Execution release failed.'
    );
    const session = Object.freeze({
      ...createSessionPortStub({
        inspect: () => Promise.resolve(createSnapshot()),
        applyNavigation: () => Promise.reject(mutationFailure),
      }),
      acquireSessionExecution: () => Promise.resolve(createExecutionLease()),
      releaseSessionExecution: () => Promise.reject(releaseFailure),
    });

    const failure = await executeSessionNavigation({
      agentId,
      navigation: {
        sessionId,
        operation: 'select',
        branchId: DEFAULT_SESSION_BRANCH_ID,
        expectedRevision: 0,
      },
      session,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([mutationFailure, releaseFailure]);
    expect((failure as AggregateError).cause).toBe(mutationFailure);
  });
});
