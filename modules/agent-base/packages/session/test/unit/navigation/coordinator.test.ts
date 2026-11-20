import { describe, expect, it, vi } from 'vitest';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  executeSessionNavigation,
  parseSessionBranchId,
  parseTurnId,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type SessionExecutionLease,
} from '../../../src/index.js';
import {
  agentId,
  createAppliedNavigation,
  createExecutionLease,
  createSnapshot,
  sessionId,
} from '../../support/navigation/coordinator-fixtures.js';
import { createSessionPortStub } from '../../support/session-port-stub.js';

describe('Session navigation coordinator coordinator', () => {
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

      const signal = new AbortController().signal;

      await expect(
        executeSessionNavigation(
          {
            agentId,
            navigation: { sessionId, ...command },
            session,
          },
          { signal }
        )
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
        signal,
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
});
