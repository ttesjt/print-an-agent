import { parseAgentId } from '@ta-agent/base-identity';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  executeSessionNavigation,
  parseSessionBranchId,
  parseSessionExecutionId,
  parseSessionId,
  parseTurnId,
  type ApplySessionNavigationRequest,
  type AppliedSessionNavigation,
  type SessionExecutionLease,
  type SessionSnapshot,
} from '../../src/index.js';
import { createSessionPortStub } from '../support/session-port-stub.js';

const agentId = parseAgentId('navigation-coordinator-agent');
const sessionId = parseSessionId('navigation-coordinator-session');

function createSnapshot(revision = 0): SessionSnapshot {
  return Object.freeze({
    agentId,
    sessionId,
    navigation: Object.freeze({
      agentId,
      sessionId,
      revision,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      branches: Object.freeze([
        Object.freeze({ branchId: DEFAULT_SESSION_BRANCH_ID, createdAt: 1 }),
      ]),
    }),
    turns: Object.freeze([]),
  });
}

function createAppliedNavigation(revision = 1): AppliedSessionNavigation {
  return Object.freeze({
    operation: 'select',
    affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
    navigation: createSnapshot(revision).navigation,
  });
}

function createExecutionLease(): SessionExecutionLease {
  return Object.freeze({
    agentId,
    sessionId,
    executionId: parseSessionExecutionId('navigation-execution'),
  });
}

describe('Session navigation domain coordinator', () => {
  it('inspects without acquiring mutation authority', async () => {
    const acquire = vi.fn(() => Promise.resolve(createExecutionLease()));
    const release = vi.fn(() => Promise.resolve());
    const inspect = vi.fn(() => Promise.resolve(createSnapshot(4)));
    const applyNavigation = vi.fn(() => Promise.resolve(createAppliedNavigation()));
    const session = Object.freeze({
      ...createSessionPortStub({ inspect, applyNavigation }),
      acquireSessionExecution: acquire,
      releaseSessionExecution: release,
    });

    await expect(
      executeSessionNavigation({
        agentId,
        navigation: { sessionId, operation: 'inspect' },
        session,
      })
    ).resolves.toMatchObject({
      status: 'inspected',
      navigation: { revision: 4, selectedBranchId: DEFAULT_SESSION_BRANCH_ID },
    });

    expect(inspect).toHaveBeenCalledWith({ agentId, sessionId });
    expect(acquire).not.toHaveBeenCalled();
    expect(applyNavigation).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('owns mutation ordering, execution authority, CAS request, and final release', async () => {
    const calls: string[] = [];
    const lease = createExecutionLease();
    const acquire = vi.fn(() => {
      calls.push('acquire');
      return Promise.resolve(lease);
    });
    const inspect = vi.fn(() => {
      calls.push('inspect');
      return Promise.resolve(createSnapshot());
    });
    const applyNavigation = vi.fn((request: ApplySessionNavigationRequest) => {
      calls.push('apply');
      expect(request).toMatchObject({
        agentId,
        sessionId,
        execution: lease,
        command: {
          operation: 'select',
          branchId: DEFAULT_SESSION_BRANCH_ID,
          expectedRevision: 0,
        },
      });
      return Promise.resolve(createAppliedNavigation());
    });
    const release = vi.fn((released: SessionExecutionLease) => {
      calls.push('release');
      expect(released).toBe(lease);
      return Promise.resolve();
    });
    const session = Object.freeze({
      ...createSessionPortStub({ inspect, applyNavigation }),
      acquireSessionExecution: acquire,
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
    ).resolves.toEqual({
      status: 'selected',
      sessionId,
      selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
      revision: 1,
    });
    expect(calls).toEqual(['acquire', 'inspect', 'apply', 'release']);
  });

  it.each([
    { operation: 'fork', provideBranchId: true },
    { operation: 'fork', provideBranchId: false },
    { operation: 'rewind', provideBranchId: true },
    { operation: 'rewind', provideBranchId: false },
  ] as const)(
    'forwards $operation authority and projects branch selection (explicit branch ID: $provideBranchId)',
    async ({ operation, provideBranchId }) => {
      const expectedRevision = 7;
      const snapshot = createSnapshot(expectedRevision);
      const lease = createExecutionLease();
      const sourceBranchId = DEFAULT_SESSION_BRANCH_ID;
      const throughTurnId = parseTurnId('completed-ancestor');
      const affectedBranchId = parseSessionBranchId(
        provideBranchId ? 'requested-child' : 'adapter-generated-child'
      );
      const selectedBranchId = operation === 'fork' ? sourceBranchId : affectedBranchId;
      const branchInput = provideBranchId ? { newBranchId: affectedBranchId } : {};
      const command =
        operation === 'fork'
          ? { operation, sourceBranchId, throughTurnId, expectedRevision, ...branchInput }
          : { operation, throughTurnId, expectedRevision, ...branchInput };
      const applied: AppliedSessionNavigation = {
        operation,
        affectedBranchId,
        navigation: {
          ...snapshot.navigation,
          revision: expectedRevision + 1,
          selectedBranchId,
          branches: [...snapshot.navigation.branches, { branchId: affectedBranchId, createdAt: 2 }],
        },
      };
      const acquire = vi.fn(() => Promise.resolve(lease));
      const inspect = vi.fn(() => Promise.resolve(snapshot));
      const applyNavigation = vi.fn(() => Promise.resolve(applied));
      const release = vi.fn(() => Promise.resolve());
      const session = Object.freeze({
        ...createSessionPortStub({ inspect, applyNavigation }),
        acquireSessionExecution: acquire,
        releaseSessionExecution: release,
      });

      await expect(
        executeSessionNavigation({
          agentId,
          navigation: { sessionId, ...command },
          session,
        })
      ).resolves.toEqual({
        status: operation === 'fork' ? 'forked' : 'rewound',
        sessionId,
        selectedBranchId,
        affectedBranchId,
        revision: expectedRevision + 1,
      });
      expect(acquire).toHaveBeenCalledExactlyOnceWith({ agentId, sessionId });
      expect(inspect).toHaveBeenCalledExactlyOnceWith({ agentId, sessionId });
      expect(applyNavigation).toHaveBeenCalledExactlyOnceWith({
        agentId,
        sessionId,
        execution: lease,
        command,
      });
      expect(release).toHaveBeenCalledExactlyOnceWith(lease);
    }
  );

  it('supports a basic navigation port while leaving CAS authority to the adapter', async () => {
    const applyNavigation = vi.fn((request: ApplySessionNavigationRequest) => {
      expect(Object.hasOwn(request, 'execution')).toBe(false);
      return Promise.resolve(createAppliedNavigation());
    });
    const session = createSessionPortStub({
      inspect: () => Promise.resolve(createSnapshot()),
      applyNavigation,
    });

    await executeSessionNavigation({
      agentId,
      navigation: {
        sessionId,
        operation: 'select',
        branchId: DEFAULT_SESSION_BRANCH_ID,
        expectedRevision: 0,
      },
      session,
    });
    expect(applyNavigation).toHaveBeenCalledOnce();
  });

  it('propagates lifecycle admission policy before inspecting a mutating command', async () => {
    const retired = new AgentSessionError('SESSION_RETIRED', 'Session is retired.');
    const inspect = vi.fn(() => Promise.resolve(createSnapshot()));
    const applyNavigation = vi.fn(() => Promise.resolve(createAppliedNavigation()));
    const release = vi.fn(() => Promise.resolve());
    const session = Object.freeze({
      ...createSessionPortStub({ inspect, applyNavigation }),
      acquireSessionExecution: () => Promise.reject(retired),
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
    ).rejects.toBe(retired);
    expect(inspect).not.toHaveBeenCalled();
    expect(applyNavigation).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

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

  it('rejects malformed records without evaluating accessors or touching the port', async () => {
    let getterRead = false;
    const navigation = { sessionId } as { sessionId: string; operation?: 'inspect' };
    Object.defineProperty(navigation, 'operation', {
      enumerable: true,
      get: () => {
        getterRead = true;
        return 'inspect' as const;
      },
    });
    const inspect = vi.fn(() => Promise.resolve(createSnapshot()));

    await expect(
      executeSessionNavigation({
        agentId,
        navigation: navigation as never,
        session: createSessionPortStub({ inspect }),
      })
    ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_INVALID' });
    expect(getterRead).toBe(false);
    expect(inspect).not.toHaveBeenCalled();
  });
});
