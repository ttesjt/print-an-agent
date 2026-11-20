import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  parseSessionBranchId,
  parseSessionExecutionId,
  parseSessionId,
  parseTurnId,
  type ApplySessionNavigationRequest,
  type SessionExecutionLease,
  type SessionExecutionPort,
  type SessionNavigationCoordinatorPort,
  type SessionSnapshot,
} from '@print-an-agent/base-session';
import { describe, expect, it, vi } from 'vitest';
import {
  createAgentManagementService,
  createSessionNavigationService,
  defineManagedAgentComposition,
  type ManagedAgentNamespace,
  type SessionNavigationPorts,
} from '../../../../../src/index.js';
import { createManagedAgentFixture } from '../../../../support/management/managed-agent-management.js';

const agentId = parseAgentId('navigation-owner');
const sessionId = parseSessionId('navigation-session');
const mainBranchId = DEFAULT_SESSION_BRANCH_ID;
const alternateBranchId = parseSessionBranchId('alternate');
const turnId = parseTurnId('turn-one');

function createSnapshot(revision = 0, selectedBranchId = mainBranchId): SessionSnapshot {
  return Object.freeze({
    agentId,
    sessionId,
    navigation: Object.freeze({
      agentId,
      sessionId,
      revision,
      selectedBranchId,
      branches: Object.freeze([
        Object.freeze({ branchId: mainBranchId, createdAt: 1 }),
        Object.freeze({
          branchId: alternateBranchId,
          parentBranchId: mainBranchId,
          forkedFromTurnId: turnId,
          createdAt: 2,
        }),
      ]),
    }),
    turns: Object.freeze([]),
  });
}

function createNavigationPortFixture() {
  let revision = 0;
  const lease: SessionExecutionLease = Object.freeze({
    agentId,
    sessionId,
    executionId: parseSessionExecutionId('navigation-execution'),
  });
  const inspect = vi.fn(() => Promise.resolve(createSnapshot(revision)));
  const acquireSessionExecution = vi.fn(() => Promise.resolve(lease));
  const releaseSessionExecution = vi.fn(() => Promise.resolve());
  const applyNavigation = vi.fn((request: ApplySessionNavigationRequest) => {
    revision += 1;
    const affectedBranchId =
      request.command.operation === 'select'
        ? request.command.branchId
        : (request.command.newBranchId ?? alternateBranchId);
    return Promise.resolve(
      Object.freeze({
        operation: request.command.operation,
        affectedBranchId,
        navigation: createSnapshot(revision, affectedBranchId).navigation,
      })
    );
  });
  const session: SessionNavigationCoordinatorPort & SessionExecutionPort = Object.freeze({
    inspect,
    applyNavigation,
    acquireSessionExecution,
    releaseSessionExecution,
  });

  return Object.freeze({
    session,
    ports: Object.freeze({ session }) satisfies SessionNavigationPorts,
    inspect,
    applyNavigation,
    acquireSessionExecution,
    releaseSessionExecution,
  });
}

function createNavigationServiceFixture(
  createPorts: (
    namespace: ManagedAgentNamespace<Readonly<{ slot: number }>>
  ) => SessionNavigationPorts
) {
  const fixture = createManagedAgentFixture({ projection: false });
  const scopedFactory = vi.fn(createPorts);
  const definition = defineManagedAgentComposition({
    ...fixture.definition,
    sessionNavigation: { createPorts: scopedFactory },
  });
  return Object.freeze({
    ...fixture,
    definition,
    management: createAgentManagementService(definition),
    navigation: createSessionNavigationService(definition),
    createNavigationPorts: scopedFactory,
  });
}

async function publishAgent(fixture: ReturnType<typeof createNavigationServiceFixture>) {
  return fixture.management.create({
    identity: { id: agentId },
    config: { label: 'navigation-owner' },
  });
}

describe('Session Navigation Service', () => {
  it('delegates every operation through fresh scoped ports without materializing a runtime', async () => {
    const portFixture = createNavigationPortFixture();
    const fixture = createNavigationServiceFixture(() => portFixture.ports);
    const created = await publishAgent(fixture);
    await fixture.management.disable({
      agentId,
      expectedIdentityRevision: created.authority.identity.revision,
    });
    fixture.events.splice(0);

    await expect(fixture.navigation.inspect({ agentId, sessionId })).resolves.toMatchObject({
      status: 'inspected',
      navigation: { revision: 0, selectedBranchId: mainBranchId },
    });
    await expect(
      fixture.navigation.select({
        agentId,
        sessionId,
        branchId: alternateBranchId,
        expectedRevision: 0,
      })
    ).resolves.toMatchObject({ status: 'selected', affectedBranchId: alternateBranchId });
    await expect(
      fixture.navigation.fork({
        agentId,
        sessionId,
        sourceBranchId: alternateBranchId,
        throughTurnId: turnId,
        newBranchId: mainBranchId,
        expectedRevision: 1,
      })
    ).resolves.toMatchObject({ status: 'forked', affectedBranchId: mainBranchId });
    await expect(
      fixture.navigation.rewind({
        agentId,
        sessionId,
        throughTurnId: turnId,
        newBranchId: alternateBranchId,
        expectedRevision: 2,
      })
    ).resolves.toMatchObject({ status: 'rewound', affectedBranchId: alternateBranchId });

    expect(fixture.createNavigationPorts).toHaveBeenCalledTimes(4);
    expect(
      fixture.createNavigationPorts.mock.calls.every(
        ([namespace]) => namespace.phase === 'published'
      )
    ).toBe(true);
    expect(portFixture.acquireSessionExecution).toHaveBeenCalledTimes(3);
    expect(portFixture.releaseSessionExecution).toHaveBeenCalledTimes(3);
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);
  });

  it('rejects cancellation before resolving resources with a stable Session failure', async () => {
    const portFixture = createNavigationPortFixture();
    const fixture = createNavigationServiceFixture(() => portFixture.ports);
    await publishAgent(fixture);
    const resolve = vi.spyOn(fixture.namespacePort, 'resolve');
    resolve.mockClear();
    const controller = new AbortController();
    controller.abort(new Error('private cancellation reason'));

    await expect(
      fixture.navigation.inspect({ agentId, sessionId }, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'SESSION_NAVIGATION_CANCELLED',
      message: 'Session navigation was cancelled before its commit boundary.',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(fixture.createNavigationPorts).not.toHaveBeenCalled();
  });

  it('cancels before mutation and still releases acquired execution authority', async () => {
    const portFixture = createNavigationPortFixture();
    const controller = new AbortController();
    portFixture.inspect.mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve(createSnapshot());
    });
    const fixture = createNavigationServiceFixture(() => portFixture.ports);
    await publishAgent(fixture);

    await expect(
      fixture.navigation.select(
        {
          agentId,
          sessionId,
          branchId: alternateBranchId,
          expectedRevision: 0,
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'SESSION_NAVIGATION_CANCELLED' });
    expect(portFixture.applyNavigation).not.toHaveBeenCalled();
    expect(portFixture.releaseSessionExecution).toHaveBeenCalledOnce();
  });

  it('allows retired inspection while preserving mutation admission failures', async () => {
    const portFixture = createNavigationPortFixture();
    portFixture.acquireSessionExecution.mockRejectedValueOnce(
      new AgentSessionError('SESSION_RETIRED', 'Session is retired.')
    );
    const fixture = createNavigationServiceFixture(() => portFixture.ports);
    await publishAgent(fixture);

    await expect(fixture.navigation.inspect({ agentId, sessionId })).resolves.toMatchObject({
      status: 'inspected',
    });
    await expect(
      fixture.navigation.select({
        agentId,
        sessionId,
        branchId: alternateBranchId,
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: 'SESSION_RETIRED' });
    expect(portFixture.applyNavigation).not.toHaveBeenCalled();
  });

  it('sanitizes private persistence failures from navigation adapters', async () => {
    const portFixture = createNavigationPortFixture();
    portFixture.inspect.mockRejectedValueOnce(
      new AgentSessionError('SESSION_STORAGE_FAILED', '/private/session.sqlite SELECT credential')
    );
    const fixture = createNavigationServiceFixture(() => portFixture.ports);
    await publishAgent(fixture);

    let failure: unknown;
    try {
      await fixture.navigation.inspect({ agentId, sessionId });
    } catch (cause: unknown) {
      failure = cause;
    }
    expect(failure).toMatchObject({
      code: 'SESSION_STORAGE_FAILED',
      message: 'Session persistence failed.',
    });
    expect(String(failure)).not.toContain('/private');
    expect(String(failure)).not.toContain('credential');
  });

  it.each([
    { placement: 'own', kind: 'getter' },
    { placement: 'own', kind: 'setter' },
    { placement: 'inherited', kind: 'getter' },
    { placement: 'inherited', kind: 'setter' },
  ] as const)(
    'rejects $placement lease $kind members without executing them',
    async ({ placement, kind }) => {
      const portFixture = createNavigationPortFixture();
      const session = {
        inspect: portFixture.inspect,
        applyNavigation: portFixture.applyNavigation,
      };
      const accessor = vi.fn(() => 'not a lease method');
      const target = placement === 'own' ? session : {};
      if (placement === 'inherited') Object.setPrototypeOf(session, target);
      for (const method of ['acquireSessionExecution', 'releaseSessionExecution']) {
        Object.defineProperty(target, method, {
          enumerable: true,
          ...(kind === 'getter' ? { get: accessor } : { set: accessor }),
        });
      }
      const fixture = createNavigationServiceFixture(() => ({ session }));
      await publishAgent(fixture);

      await expect(
        fixture.navigation.select({
          agentId,
          sessionId,
          branchId: alternateBranchId,
          expectedRevision: 0,
        })
      ).rejects.toMatchObject({ code: 'MANAGED_AGENT_SESSION_INVALID' });
      expect(accessor).not.toHaveBeenCalled();
      expect(portFixture.inspect).not.toHaveBeenCalled();
      expect(portFixture.applyNavigation).not.toHaveBeenCalled();
      expect(portFixture.acquireSessionExecution).not.toHaveBeenCalled();
      expect(portFixture.releaseSessionExecution).not.toHaveBeenCalled();
    }
  );

  it.each(['acquireSessionExecution', 'releaseSessionExecution'] as const)(
    'rejects a partial execution port containing only %s',
    async (method) => {
      const portFixture = createNavigationPortFixture();
      const session = {
        inspect: portFixture.inspect,
        applyNavigation: portFixture.applyNavigation,
      };
      Object.defineProperty(session, method, { value: portFixture.session[method] });
      const fixture = createNavigationServiceFixture(() => ({ session }));
      await publishAgent(fixture);

      await expect(
        fixture.navigation.select({
          agentId,
          sessionId,
          branchId: alternateBranchId,
          expectedRevision: 0,
        })
      ).rejects.toMatchObject({ code: 'MANAGED_AGENT_SESSION_INVALID' });
      expect(portFixture.inspect).not.toHaveBeenCalled();
      expect(portFixture.applyNavigation).not.toHaveBeenCalled();
      expect(portFixture.acquireSessionExecution).not.toHaveBeenCalled();
      expect(portFixture.releaseSessionExecution).not.toHaveBeenCalled();
    }
  );

  it.each(['absent', 'inherited'] as const)(
    'accepts %s execution methods without forcing optional lease capability',
    async (executionMethods) => {
      const portFixture = createNavigationPortFixture();
      const session = {
        inspect: portFixture.inspect,
        applyNavigation: portFixture.applyNavigation,
      };
      if (executionMethods === 'inherited') {
        Object.setPrototypeOf(session, {
          acquireSessionExecution: portFixture.acquireSessionExecution,
          releaseSessionExecution: portFixture.releaseSessionExecution,
        });
      }
      const fixture = createNavigationServiceFixture(() => ({ session }));
      await publishAgent(fixture);

      await expect(
        fixture.navigation.select({
          agentId,
          sessionId,
          branchId: alternateBranchId,
          expectedRevision: 0,
        })
      ).resolves.toMatchObject({ status: 'selected', revision: 1 });
      expect(portFixture.applyNavigation).toHaveBeenCalledOnce();
      if (executionMethods === 'inherited') {
        expect(portFixture.acquireSessionExecution).toHaveBeenCalledOnce();
        expect(portFixture.releaseSessionExecution).toHaveBeenCalledOnce();
        expect(portFixture.applyNavigation.mock.calls[0]?.[0]).toHaveProperty('execution');
      } else {
        expect(portFixture.acquireSessionExecution).not.toHaveBeenCalled();
        expect(portFixture.releaseSessionExecution).not.toHaveBeenCalled();
        expect(portFixture.applyNavigation.mock.calls[0]?.[0]).not.toHaveProperty('execution');
      }
    }
  );
});
