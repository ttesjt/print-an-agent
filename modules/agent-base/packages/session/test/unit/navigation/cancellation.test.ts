import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SESSION_BRANCH_ID, executeSessionNavigation } from '../../../src/index.js';
import {
  agentId,
  createAppliedNavigation,
  createExecutionLease,
  createSnapshot,
  sessionId,
} from '../../support/navigation/coordinator-fixtures.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

describe('Session navigation coordinator cancellation', () => {
  it('cancels after lease admission but before inspection and always releases the lease', async () => {
    const controller = new AbortController();
    const reason = new Error('caller stopped navigation');
    const lease = createExecutionLease();
    const inspect = vi.fn(() => Promise.resolve(createSnapshot()));
    const applyNavigation = vi.fn(() => Promise.resolve(createAppliedNavigation()));
    const release = vi.fn(() => Promise.resolve());
    const session = Object.freeze({
      ...createSessionPortStub({ inspect, applyNavigation }),
      acquireSessionExecution: () => {
        controller.abort(reason);
        return Promise.resolve(lease);
      },
      releaseSessionExecution: release,
    });

    await expect(
      executeSessionNavigation(
        {
          agentId,
          navigation: {
            sessionId,
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: 0,
          },
          session,
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_CANCELLED', cause: reason });
    expect(inspect).not.toHaveBeenCalled();
    expect(applyNavigation).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(lease);
  });

  it('does not touch Session resources when cancellation already exists', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already cancelled'));
    const inspect = vi.fn(() => Promise.resolve(createSnapshot()));
    const applyNavigation = vi.fn(() => Promise.resolve(createAppliedNavigation()));

    await expect(
      executeSessionNavigation(
        {
          agentId,
          navigation: {
            sessionId,
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: 0,
          },
          session: createSessionPortStub({ inspect, applyNavigation }),
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_CANCELLED' });
    expect(inspect).not.toHaveBeenCalled();
    expect(applyNavigation).not.toHaveBeenCalled();
  });

  it('does not report cancellation after an adapter mutation has already started and committed', async () => {
    const controller = new AbortController();
    const release = vi.fn(() => Promise.resolve());
    const session = Object.freeze({
      ...createSessionPortStub({
        inspect: () => Promise.resolve(createSnapshot()),
        applyNavigation: () => {
          controller.abort(new Error('late cancellation'));
          return Promise.resolve(createAppliedNavigation());
        },
      }),
      acquireSessionExecution: () => Promise.resolve(createExecutionLease()),
      releaseSessionExecution: release,
    });

    await expect(
      executeSessionNavigation(
        {
          agentId,
          navigation: {
            sessionId,
            operation: 'select',
            branchId: DEFAULT_SESSION_BRANCH_ID,
            expectedRevision: 0,
          },
          session,
        },
        { signal: controller.signal }
      )
    ).resolves.toMatchObject({ status: 'selected', revision: 1 });
    expect(release).toHaveBeenCalledOnce();
  });
});
