import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
  defineManagedAgentComposition,
  type ManagedAgentAuthorityPorts,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { describe, expect, it, vi } from 'vitest';
import { testMemoryDefinition } from '../../support/owned-setup.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../../support/resource-profile.js';

describe('Standalone Memory profile', () => {
  it('shares complete persistence across Services and fresh runtimes, including Config updates', async () => {
    const invoked = vi.fn();
    const definition = testMemoryDefinition(resourceProfileRuntimeOptions(invoked));
    const agents = createAgentManagementService(definition);
    const runtimes = createAgentRuntimeService(definition);
    const sessions = createSessionManagementService(definition);
    const navigation = createSessionNavigationService(definition);
    const created = await agents.create({
      identity: { id: 'alpha' },
      config: resourceProfileConfig(),
    });
    const agentId = created.authority.identity.identity.id;
    expect(created.projection).toEqual({ kind: 'not-configured' });
    expect((await sessions.list({ agentId })).records).toEqual([]);
    const [first, second] = await Promise.all([runtimes.open(agentId), runtimes.open(agentId)]);
    expect(first).not.toBe(second);
    expect(first.resources.session).toBe(second.resources.session);
    expect(first.resources.requestJournal).toBe(second.resources.requestJournal);
    const resolved = await first.resources.session.resolve({ agentId });
    const response = await first.invoke('foreground', {
      message: 'hello',
      sessionId: resolved.sessionId,
      idempotencyKey: 'hello',
    });
    const request = { message: 'hello', sessionId: response.sessionId, idempotencyKey: 'hello' };
    await expect(second.invoke('foreground', request)).resolves.toEqual(response);
    expect(invoked).toHaveBeenCalledOnce();
    expect(
      (await sessions.listTurns({ agentId, sessionId: response.sessionId }))?.records
    ).toHaveLength(1);
    await expect(
      navigation.inspect({ agentId, sessionId: response.sessionId })
    ).resolves.toMatchObject({ status: 'inspected', navigation: { revision: 1 } });

    await agents.updateConfig({
      agentId,
      config: resourceProfileConfig('Updated instructions.'),
      expectedRevision: 1,
    });
    const updated = await runtimes.open(agentId);
    expect(updated.resources.session).toBe(first.resources.session);
    expect(updated.resources.requestJournal).toBe(first.resources.requestJournal);
    await expect(updated.invoke('foreground', request)).resolves.toEqual(response);
    expect(invoked).toHaveBeenCalledOnce();
    expect((await agents.inspect(agentId)).config.revision).toBe(2);

    // Definition reference identity is not authority identity: these closures share one scope.
    const sibling = createSessionManagementService(
      defineManagedAgentComposition({ ...definition })
    );
    expect(await sibling.inspect({ agentId, sessionId: response.sessionId })).toEqual(
      await sessions.inspect({ agentId, sessionId: response.sessionId })
    );
  });

  it('isolates Agents in a scope and identical Agent IDs in independently created scopes', async () => {
    const options = resourceProfileRuntimeOptions(() => undefined);
    const firstDefinition = testMemoryDefinition(options);
    const otherDefinition = testMemoryDefinition(options);
    const firstManagement = createAgentManagementService(firstDefinition);
    const otherManagement = createAgentManagementService(otherDefinition);
    const alpha = parseAgentId('alpha');
    const bravo = parseAgentId('bravo');
    for (const agentId of [alpha, bravo]) {
      await firstManagement.create({ identity: { id: agentId }, config: resourceProfileConfig() });
    }
    await expect(otherManagement.inspect(alpha)).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NOT_FOUND',
    });
    await otherManagement.create({
      identity: { id: alpha },
      config: resourceProfileConfig('Other scope.'),
    });
    const firstRuntimes = createAgentRuntimeService(firstDefinition);
    const first = await firstRuntimes.open(alpha);
    const differentAgent = await firstRuntimes.open(bravo);
    const differentScope = await createAgentRuntimeService(otherDefinition).open(alpha);
    const response = await first.invoke('foreground', { message: 'only here' });
    const ownSessions = createSessionManagementService(firstDefinition);
    const otherSessions = createSessionManagementService(otherDefinition);

    expect(differentAgent.resources.session).not.toBe(first.resources.session);
    expect(differentScope.resources.session).not.toBe(first.resources.session);
    expect(differentScope.resources.requestJournal).not.toBe(first.resources.requestJournal);
    expect((await ownSessions.list({ agentId: bravo })).records).toEqual([]);
    expect((await otherSessions.list({ agentId: alpha })).records).toEqual([]);
    expect(
      await ownSessions.inspect({ agentId: bravo, sessionId: response.sessionId })
    ).toBeUndefined();
    await firstManagement.updateConfig({
      agentId: alpha,
      config: resourceProfileConfig('First scope.'),
      expectedRevision: 1,
    });
    expect((await otherManagement.inspect(alpha)).config).toMatchObject({
      revision: 1,
      value: { mainActor: { instructions: 'Other scope.' } },
    });
    expect((await firstManagement.list()).map((entry) => entry.identity.identity.id)).toEqual([
      alpha,
      bravo,
    ]);
  });

  it('allows only one concurrent creator without discarding the winning allocation', async () => {
    const definition = testMemoryDefinition({
      readEnvironmentVariable: () => undefined,
    });
    const agents = createAgentManagementService(definition);
    const request = { identity: { id: 'alpha' }, config: resourceProfileConfig() };
    const results = await Promise.allSettled([agents.create(request), agents.create(request)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(results[1]).toMatchObject({ reason: { code: 'MANAGED_AGENT_ALREADY_EXISTS' } });
    await expect(agents.create(request)).rejects.toMatchObject({
      code: 'MANAGED_AGENT_ALREADY_EXISTS',
    });
    expect((await agents.inspect(parseAgentId('alpha'))).config.revision).toBe(1);
  });

  it('aborts partial provisioning and retries with fresh Identity and Config authority', async () => {
    const definition = testMemoryDefinition({
      readEnvironmentVariable: () => undefined,
    });
    const broken = defineManagedAgentComposition({
      ...definition,
      authority: {
        createPorts: (namespace): ManagedAgentAuthorityPorts => {
          const ports = definition.authority.createPorts(namespace);
          return {
            identityCatalog: ports.identityCatalog,
            config: {
              read: (agentId) => ports.config.read(agentId),
              write: () => Promise.reject(new Error('Injected Config write failure.')),
            },
          };
        },
      },
    });
    const agents = createAgentManagementService(definition);
    await expect(
      createAgentManagementService(broken).create({
        identity: { id: 'alpha' },
        config: resourceProfileConfig(),
      })
    ).rejects.toMatchObject({ code: 'MANAGED_AGENT_OPERATION_FAILED' });
    expect(await agents.list()).toEqual([]);
    await expect(
      agents.create({
        identity: { id: 'alpha', displayName: 'Fresh identity' },
        config: resourceProfileConfig('Fresh config.'),
      })
    ).resolves.toMatchObject({
      authority: {
        identity: { revision: 1, identity: { displayName: 'Fresh identity' } },
        config: { revision: 1 },
      },
    });
  });
});
