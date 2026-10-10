import type { SessionManagementService } from '@ta-agent/base-composition';
import {
  defineSessionExecutionFence,
  defineSessionLifecycleSnapshot,
} from '@ta-agent/base-session';
import { describe, expect, it, vi } from 'vitest';
import { projectStandaloneSessionManagementService } from '../../src/services/session-management-service.js';

const SNAPSHOT = defineSessionLifecycleSnapshot({
  agentId: 'agent-one',
  sessionId: 'session-one',
  status: 'active',
  metadataRevision: 1,
  metadataUpdatedAt: 1,
});
const FENCE = defineSessionExecutionFence({
  revision: 1,
  state: 'ready',
  activeLeaseCount: 0,
  pendingWorkCount: 0,
});

function genericService() {
  const methods = {
    list: vi.fn<SessionManagementService['list']>(() => Promise.resolve({ records: [] })),
    listRetired: vi.fn<SessionManagementService['listRetired']>(() =>
      Promise.resolve({ records: [] })
    ),
    inspect: vi.fn<SessionManagementService['inspect']>(() => Promise.resolve(undefined)),
    listTurns: vi.fn<SessionManagementService['listTurns']>(() => Promise.resolve(undefined)),
    retire: vi.fn<SessionManagementService['retire']>(() => Promise.resolve(SNAPSHOT)),
    restore: vi.fn<SessionManagementService['restore']>(() => Promise.resolve(SNAPSHOT)),
    purge: vi.fn<SessionManagementService['purge']>(() => Promise.resolve()),
    recover: vi.fn<SessionManagementService['recover']>(() => Promise.resolve(FENCE)),
  };
  return { methods, service: methods satisfies SessionManagementService };
}

describe('Standalone Session management projection', () => {
  it('projects plain host inputs onto every branded generic operation', async () => {
    const { methods, service } = genericService();
    const projected = projectStandaloneSessionManagementService(service);
    const options = { signal: new AbortController().signal };

    await projected.list(
      {
        agentId: 'agent-one',
        cursor: { updatedAt: 10, sessionId: 'session-one' },
        limit: 20,
      },
      options
    );
    await projected.listRetired(
      {
        agentId: 'agent-one',
        cursor: { retiredAt: 11, sessionId: 'session-one' },
        limit: 21,
      },
      options
    );
    await projected.inspect({ agentId: 'agent-one', sessionId: 'session-one' }, options);
    await projected.listTurns(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        beforeTurnId: 'turn-one',
        limit: 22,
      },
      options
    );
    await projected.retire(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedRevision: 1,
      },
      options
    );
    await projected.restore(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedRevision: 2,
      },
      options
    );
    await projected.purge(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedRevision: 3,
        confirmation: 'permanently-delete-session',
      },
      options
    );
    await projected.recover(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedExecutionRevision: 4,
      },
      options
    );

    expect(methods.list).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        cursor: { updatedAt: 10, sessionId: 'session-one' },
        limit: 20,
      },
      options
    );
    expect(methods.listRetired).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        cursor: { retiredAt: 11, sessionId: 'session-one' },
        limit: 21,
      },
      options
    );
    expect(methods.inspect).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
      },
      options
    );
    expect(methods.listTurns).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        beforeTurnId: 'turn-one',
        limit: 22,
      },
      options
    );
    expect(methods.retire).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedRevision: 1,
      },
      options
    );
    expect(methods.restore).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedRevision: 2,
      },
      options
    );
    expect(methods.purge).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedRevision: 3,
        confirmation: 'permanently-delete-session',
      },
      options
    );
    expect(methods.recover).toHaveBeenCalledWith(
      {
        agentId: 'agent-one',
        sessionId: 'session-one',
        expectedExecutionRevision: 4,
      },
      options
    );
    expect(Object.isFrozen(projected)).toBe(true);
  });

  it('rejects invalid host identifiers before calling the generic Service', () => {
    const { methods, service } = genericService();
    const projected = projectStandaloneSessionManagementService(service);

    expect(() => projected.inspect({ agentId: 'invalid id', sessionId: 'session-one' })).toThrow();
    expect(methods.inspect).not.toHaveBeenCalled();
  });
});
