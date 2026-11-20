import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentSessionError,
  parseSessionBranchId,
  parseSessionId,
  type RetiredSessionListPage,
  type SessionExecutionFence,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecyclePort,
  type SessionLifecycleQueryPort,
  type SessionLifecycleSnapshot,
  type SessionTurnPage,
} from '@print-an-agent/base-session';
import { describe, expect, it, vi } from 'vitest';
import {
  AgentManagementError,
  createAgentManagementService,
  createSessionManagementService,
  defineManagedAgentComposition,
  type CoordinatedSessionMaintenancePort,
  type ManagedAgentNamespace,
  type SessionManagementPorts,
} from '../../src/index.js';
import { createManagedAgentFixture } from '../support/managed-agent-management.js';

interface TestNamespaceHandle {
  readonly slot: number;
}

function createSessionPortFixture() {
  const agentId = parseAgentId('alpha');
  const sessionId = parseSessionId('session-one');
  const activeSnapshot: SessionLifecycleSnapshot = Object.freeze({
    agentId,
    sessionId,
    status: 'active',
    metadataRevision: 2,
    metadataUpdatedAt: 20,
  });
  const retiredSnapshot: SessionLifecycleSnapshot = Object.freeze({
    agentId,
    sessionId,
    status: 'retired',
    retiredAt: 20,
    metadataRevision: 1,
    metadataUpdatedAt: 20,
  });
  const inspection: SessionLifecycleInspection = Object.freeze({
    ...activeSnapshot,
    createdAt: 10,
    updatedAt: 20,
    selectedBranchId: parseSessionBranchId('main'),
    navigationRevision: 0,
    branchCount: 1,
    turnCount: 0,
    execution: Object.freeze({
      revision: 3,
      state: 'ready',
      activeLeaseCount: 0,
      pendingWorkCount: 0,
    }),
  });
  const activePage: SessionLifecycleListPage = Object.freeze({
    records: Object.freeze([]),
  });
  const retiredPage: RetiredSessionListPage = Object.freeze({
    records: Object.freeze([]),
  });
  const turnPage: SessionTurnPage = Object.freeze({ records: Object.freeze([]) });
  const recoveredFence: SessionExecutionFence = Object.freeze({
    revision: 4,
    state: 'ready',
    activeLeaseCount: 0,
    pendingWorkCount: 0,
  });

  const listSessions = vi.fn(() => Promise.resolve(activePage));
  const inspectSession = vi.fn(() => Promise.resolve(inspection));
  const listRetiredSessions = vi.fn(() => Promise.resolve(retiredPage));
  const listSessionTurns = vi.fn(() => Promise.resolve(turnPage));
  const retireSession = vi.fn(() => Promise.resolve(retiredSnapshot));
  const restoreSession = vi.fn(() => Promise.resolve(activeSnapshot));
  const purgeSessionPersistence = vi.fn(() => Promise.resolve());
  const recoverSessionPersistence = vi.fn(() => Promise.resolve(recoveredFence));
  const session: SessionLifecycleQueryPort & SessionLifecyclePort = {
    listSessions,
    inspectSession,
    listRetiredSessions,
    listSessionTurns,
    retireSession,
    restoreSession,
  };
  const maintenance: CoordinatedSessionMaintenancePort = {
    purgeSessionPersistence,
    recoverSessionPersistence,
  };

  return Object.freeze({
    agentId,
    sessionId,
    activeSnapshot,
    retiredSnapshot,
    inspection,
    activePage,
    retiredPage,
    turnPage,
    recoveredFence,
    listSessions,
    inspectSession,
    listRetiredSessions,
    listSessionTurns,
    retireSession,
    restoreSession,
    purgeSessionPersistence,
    recoverSessionPersistence,
    session,
    maintenance,
    ports: Object.freeze({ session, maintenance }) satisfies SessionManagementPorts,
  });
}

function createSessionManagedFixture(
  createPorts: (
    namespace: ManagedAgentNamespace<TestNamespaceHandle>
  ) => SessionManagementPorts | Promise<SessionManagementPorts>
) {
  const fixture = createManagedAgentFixture({ projection: false });
  const definition = defineManagedAgentComposition({
    ...fixture.definition,
    sessionManagement: { createPorts },
  });
  return Object.freeze({
    ...fixture,
    definition,
    management: createAgentManagementService(definition),
    sessions: createSessionManagementService(definition),
  });
}

describe('Session Management Service', () => {
  it('is zero-I/O and delegates every operation through fresh scoped ports', async () => {
    const portFixture = createSessionPortFixture();
    const createPorts = vi.fn((namespace: ManagedAgentNamespace<TestNamespaceHandle>) => {
      void namespace;
      return Promise.resolve(portFixture.ports);
    });
    const fixture = createSessionManagedFixture(createPorts);

    expect(Object.isFrozen(fixture.sessions)).toBe(true);
    expect(createPorts).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);

    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    fixture.events.splice(0);

    await expect(
      fixture.sessions.list({
        agentId: portFixture.agentId,
        cursor: { updatedAt: 20, sessionId: portFixture.sessionId },
        limit: 10,
      })
    ).resolves.toBe(portFixture.activePage);
    await expect(
      fixture.sessions.listRetired({
        agentId: portFixture.agentId,
        cursor: { retiredAt: 20, sessionId: portFixture.sessionId },
        limit: 11,
      })
    ).resolves.toBe(portFixture.retiredPage);
    await expect(
      fixture.sessions.inspect({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
      })
    ).resolves.toBe(portFixture.inspection);
    await expect(
      fixture.sessions.listTurns({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        beforeTurnId: 'turn-before',
        limit: 12,
      })
    ).resolves.toBe(portFixture.turnPage);
    await expect(
      fixture.sessions.retire({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 0,
      })
    ).resolves.toBe(portFixture.retiredSnapshot);
    await expect(
      fixture.sessions.restore({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 1,
      })
    ).resolves.toBe(portFixture.activeSnapshot);
    await expect(
      fixture.sessions.purge({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 2,
        confirmation: 'permanently-delete-session',
      })
    ).resolves.toBeUndefined();
    await expect(
      fixture.sessions.recover({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedExecutionRevision: 3,
      })
    ).resolves.toBe(portFixture.recoveredFence);

    expect(createPorts).toHaveBeenCalledTimes(8);
    expect(createPorts.mock.calls.every(([namespace]) => namespace.phase === 'published')).toBe(
      true
    );
    expect(portFixture.purgeSessionPersistence).toHaveBeenCalledOnce();
    expect(portFixture.recoverSessionPersistence).toHaveBeenCalledOnce();
    expect(portFixture.listSessions).toHaveBeenCalledWith({
      agentId: portFixture.agentId,
      cursor: { updatedAt: 20, sessionId: portFixture.sessionId },
      limit: 10,
    });
    expect(portFixture.listRetiredSessions).toHaveBeenCalledWith({
      agentId: portFixture.agentId,
      cursor: { retiredAt: 20, sessionId: portFixture.sessionId },
      limit: 11,
    });
    expect(portFixture.listSessionTurns).toHaveBeenCalledWith({
      agentId: portFixture.agentId,
      sessionId: portFixture.sessionId,
      beforeTurnId: 'turn-before',
      limit: 12,
    });
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);
  });

  it('preserves missing inspection and Turn history as undefined', async () => {
    const portFixture = createSessionPortFixture();
    portFixture.session.inspectSession = vi.fn(() => Promise.resolve(undefined));
    portFixture.session.listSessionTurns = vi.fn(() => Promise.resolve(undefined));
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    const reference = { agentId: portFixture.agentId, sessionId: portFixture.sessionId };

    await expect(fixture.sessions.inspect(reference)).resolves.toBeUndefined();
    await expect(fixture.sessions.listTurns(reference)).resolves.toBeUndefined();
  });

  it('binds request identity before asynchronous namespace work', async () => {
    const portFixture = createSessionPortFixture();
    const fixture = createSessionManagedFixture(() => Promise.resolve(portFixture.ports));
    const bravoId = parseAgentId('bravo');
    const bravoSessionId = parseSessionId('session-two');
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'alpha' },
    });
    await fixture.management.create({ identity: { id: bravoId }, config: { label: 'bravo' } });
    const input = { agentId: portFixture.agentId, sessionId: portFixture.sessionId };

    const pending = fixture.sessions.inspect(input);
    input.agentId = bravoId;
    input.sessionId = bravoSessionId;
    await pending;

    expect(portFixture.inspectSession).toHaveBeenCalledWith({
      agentId: portFixture.agentId,
      sessionId: portFixture.sessionId,
    });
  });

  it('keeps disabled Agent resources manageable without authority or runtime access', async () => {
    const portFixture = createSessionPortFixture();
    const createPorts = vi.fn(() => portFixture.ports);
    const fixture = createSessionManagedFixture(createPorts);
    const created = await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    await fixture.management.disable({
      agentId: portFixture.agentId,
      expectedIdentityRevision: created.authority.identity.revision,
    });
    fixture.events.splice(0);

    await expect(fixture.sessions.list({ agentId: portFixture.agentId })).resolves.toBe(
      portFixture.activePage
    );

    expect(createPorts).toHaveBeenCalledOnce();
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);
  });

  it('does not purge when cancellation arrives during namespace resolution', async () => {
    const portFixture = createSessionPortFixture();
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalResolve = fixture.namespacePort.resolve.bind(fixture.namespacePort);
    fixture.namespacePort.resolve = async (agentId) => {
      entered.resolve();
      await release.promise;
      return originalResolve(agentId);
    };
    const controller = new AbortController();

    const purging = fixture.sessions.purge(
      {
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 2,
        confirmation: 'permanently-delete-session',
      },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(purging).rejects.toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_CANCELLED',
      operation: 'purge-session',
    });
    expect(portFixture.purgeSessionPersistence).not.toHaveBeenCalled();
    await expect(
      fixture.sessions.purge({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 2,
        confirmation: 'permanently-delete-session',
      })
    ).resolves.toBeUndefined();
    expect(portFixture.purgeSessionPersistence).toHaveBeenCalledOnce();
  });

  it('blocks every lifecycle mutation when cancellation arrives during Port preparation', async () => {
    const portFixture = createSessionPortFixture();
    let entered = Promise.withResolvers<void>();
    let release = Promise.withResolvers<void>();
    const fixture = createSessionManagedFixture(async () => {
      entered.resolve();
      await release.promise;
      return portFixture.ports;
    });
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    const cases = [
      {
        operation: 'retire-session',
        invoke: (signal: AbortSignal) =>
          fixture.sessions.retire(
            {
              agentId: portFixture.agentId,
              sessionId: portFixture.sessionId,
              expectedRevision: 0,
            },
            { signal }
          ),
        called: portFixture.retireSession,
      },
      {
        operation: 'restore-session',
        invoke: (signal: AbortSignal) =>
          fixture.sessions.restore(
            {
              agentId: portFixture.agentId,
              sessionId: portFixture.sessionId,
              expectedRevision: 1,
            },
            { signal }
          ),
        called: portFixture.restoreSession,
      },
      {
        operation: 'recover-session',
        invoke: (signal: AbortSignal) =>
          fixture.sessions.recover(
            {
              agentId: portFixture.agentId,
              sessionId: portFixture.sessionId,
              expectedExecutionRevision: 3,
            },
            { signal }
          ),
        called: portFixture.recoverSessionPersistence,
      },
    ] as const;

    for (const testCase of cases) {
      const controller = new AbortController();
      const pending = testCase.invoke(controller.signal);
      await entered.promise;
      controller.abort();
      release.resolve();
      await expect(pending).rejects.toMatchObject({
        code: 'MANAGED_AGENT_OPERATION_CANCELLED',
        operation: testCase.operation,
      });
      expect(testCase.called).not.toHaveBeenCalled();
      entered = Promise.withResolvers<void>();
      release = Promise.withResolvers<void>();
    }
  });

  it('waits for and returns the real Session outcome after a mutation begins', async () => {
    const portFixture = createSessionPortFixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const purge = vi.fn(async () => {
      entered.resolve();
      await release.promise;
    });
    portFixture.maintenance.purgeSessionPersistence = purge;
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    const controller = new AbortController();

    const purging = fixture.sessions.purge(
      {
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 2,
        confirmation: 'permanently-delete-session',
      },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(purging).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledOnce();
  });

  it('fails closed when the scoped factory omits a required standard capability', async () => {
    const portFixture = createSessionPortFixture();
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });
    Reflect.deleteProperty(portFixture.session, 'listSessions');

    await expect(fixture.sessions.list({ agentId: portFixture.agentId })).rejects.toMatchObject({
      code: 'MANAGED_AGENT_SESSION_INVALID',
      operation: 'list-sessions',
      message: 'Session management ports.session.listSessions must be a function.',
    });
  });

  it('sanitizes raw factory and private Session persistence failures', async () => {
    const portFixture = createSessionPortFixture();
    let factoryFailure: Error | undefined = new Error('/private/session.sqlite SELECT credential');
    const fixture = createSessionManagedFixture(() => {
      if (factoryFailure !== undefined) throw factoryFailure;
      return portFixture.ports;
    });
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });

    let failure: unknown;
    try {
      await fixture.sessions.list({ agentId: portFixture.agentId });
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(AgentManagementError);
    expect(failure).toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_FAILED',
      operation: 'list-sessions',
      message: 'Managed Agent operation failed.',
    });
    expect(String(failure)).not.toContain('/private');
    expect(String(failure)).not.toContain('credential');

    factoryFailure = undefined;
    portFixture.session.listSessions = vi.fn(() =>
      Promise.reject(
        new AgentSessionError('SESSION_STORAGE_FAILED', '/private/session.sqlite SELECT credential')
      )
    );
    failure = undefined;
    try {
      await fixture.sessions.list({ agentId: portFixture.agentId });
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(AgentSessionError);
    expect(failure).toMatchObject({
      code: 'SESSION_STORAGE_FAILED',
      message: 'Session persistence failed.',
    });
    expect(String(failure)).not.toContain('/private');
    expect(String(failure)).not.toContain('credential');
  });

  it('preserves safe Session validation and CAS failures', async () => {
    const portFixture = createSessionPortFixture();
    portFixture.session.retireSession = vi.fn(() =>
      Promise.reject(
        new AgentSessionError('SESSION_METADATA_CONFLICT', 'Session metadata revision changed.')
      )
    );
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });

    await expect(
      fixture.sessions.retire({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({
      code: 'SESSION_METADATA_CONFLICT',
      message: 'Session metadata revision changed.',
    });
  });

  it('sanitizes coordinated purge persistence failures', async () => {
    const portFixture = createSessionPortFixture();
    portFixture.maintenance.purgeSessionPersistence = vi.fn(() =>
      Promise.reject(
        new AgentSessionError('SESSION_PURGE_FAILED', '/private/session.sqlite DELETE credential')
      )
    );
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });

    let failure: unknown;
    try {
      await fixture.sessions.purge({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedRevision: 1,
        confirmation: 'permanently-delete-session',
      });
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(AgentSessionError);
    expect(failure).toMatchObject({
      code: 'SESSION_PURGE_FAILED',
      message: 'Session persistence failed.',
    });
    expect(String(failure)).not.toContain('/private');
    expect(String(failure)).not.toContain('credential');
  });

  it('sanitizes coordinated recovery persistence failures', async () => {
    const portFixture = createSessionPortFixture();
    portFixture.maintenance.recoverSessionPersistence = vi.fn(() =>
      Promise.reject(
        new AgentSessionError(
          'SESSION_RECOVERY_FAILED',
          'https://private.example/recovery?credential=secret'
        )
      )
    );
    const fixture = createSessionManagedFixture(() => portFixture.ports);
    await fixture.management.create({
      identity: { id: portFixture.agentId },
      config: { label: 'session-owner' },
    });

    let failure: unknown;
    try {
      await fixture.sessions.recover({
        agentId: portFixture.agentId,
        sessionId: portFixture.sessionId,
        expectedExecutionRevision: 3,
      });
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(AgentSessionError);
    expect(failure).toMatchObject({
      code: 'SESSION_RECOVERY_FAILED',
      message: 'Session persistence failed.',
    });
    expect(String(failure)).not.toContain('private.example');
    expect(String(failure)).not.toContain('credential');
  });
});
