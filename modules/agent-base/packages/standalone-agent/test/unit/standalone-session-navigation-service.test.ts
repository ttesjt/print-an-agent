import type { SessionNavigationService } from '@ta-agent/base-composition';
import { parseAgentId } from '@ta-agent/base-identity';
import {
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseSessionId,
  type SessionNavigationSnapshot,
} from '@ta-agent/base-session';
import { describe, expect, it, vi } from 'vitest';
import { projectStandaloneSessionNavigationService } from '../../src/index.js';

const navigation: SessionNavigationSnapshot = Object.freeze({
  agentId: parseAgentId('agent-one'),
  sessionId: parseSessionId('session-one'),
  revision: 1,
  selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
  branches: Object.freeze([]),
});

function genericService() {
  const methods = {
    inspect: vi.fn<SessionNavigationService['inspect']>(() =>
      Promise.resolve({ status: 'inspected', navigation })
    ),
    select: vi.fn<SessionNavigationService['select']>(() =>
      Promise.resolve({
        status: 'selected',
        sessionId: 'session-one',
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        revision: 1,
      })
    ),
    fork: vi.fn<SessionNavigationService['fork']>(() =>
      Promise.resolve({
        status: 'forked',
        sessionId: 'session-one',
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        revision: 1,
      })
    ),
    rewind: vi.fn<SessionNavigationService['rewind']>(() =>
      Promise.resolve({
        status: 'rewound',
        sessionId: 'session-one',
        selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        affectedBranchId: DEFAULT_SESSION_BRANCH_ID,
        revision: 1,
      })
    ),
  };
  return { methods, service: methods satisfies SessionNavigationService };
}

describe('Standalone Session navigation projection', () => {
  it('projects plain host inputs and preserves per-operation cancellation', async () => {
    const { methods, service } = genericService();
    const projected = projectStandaloneSessionNavigationService(service);
    const signal = new AbortController().signal;

    await projected.inspect({ agentId: 'agent-one', sessionId: 'session-one' }, { signal });
    await projected.select(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        branchId: 'branch-one',
        expectedRevision: 1,
      },
      { signal }
    );
    await projected.fork(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        sourceBranchId: 'branch-one',
        throughTurnId: 'turn-one',
        newBranchId: 'branch-two',
        expectedRevision: 2,
      },
      { signal }
    );
    await projected.rewind(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        throughTurnId: 'turn-two',
        expectedRevision: 3,
      },
      { signal }
    );

    expect(methods.inspect).toHaveBeenCalledWith(
      { agentId: 'agent-one', sessionId: 'session-one' },
      { signal }
    );
    expect(methods.select).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        branchId: parseSessionBranchId('branch-one'),
        expectedRevision: 1,
      },
      { signal }
    );
    expect(methods.fork).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        sourceBranchId: parseSessionBranchId('branch-one'),
        throughTurnId: 'turn-one',
        newBranchId: parseSessionBranchId('branch-two'),
        expectedRevision: 2,
      },
      { signal }
    );
    expect(methods.rewind).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        throughTurnId: 'turn-two',
        expectedRevision: 3,
      },
      { signal }
    );
    expect(Object.isFrozen(projected)).toBe(true);
  });

  it('rejects invalid host identifiers before calling the generic Service', () => {
    const { methods, service } = genericService();
    const projected = projectStandaloneSessionNavigationService(service);

    expect(() =>
      projected.select({
        agentId: 'invalid id',
        sessionId: 'session-one',
        branchId: 'branch-one',
        expectedRevision: 0,
      })
    ).toThrow();
    expect(methods.select).not.toHaveBeenCalled();
  });
});
