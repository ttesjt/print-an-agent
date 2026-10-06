import { parseAgentId } from '@ta-agent/base-identity';
import { createAgent } from '@ta-agent/base-workflow';
import { describe, expect, it, vi } from 'vitest';
import {
  createAgentManagementService,
  createAgentRuntimeService,
  defineManagedAgentComposition,
  type ManagedAgentRuntimeMaterializationInput,
} from '../../src/index.js';
import {
  createManagedAgentFixture,
  type TestManagedAgentConfig,
} from '../support/managed-agent-management.js';

describe('authoritative runtime provisioning', () => {
  it('supplies a frozen context with current Identity and typed Config snapshots', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await management.create({
      identity: { id: agentId, displayName: 'Alpha' },
      config: { label: 'initial' },
    });
    await management.disable({ agentId, expectedIdentityRevision: 1 });
    const active = await management.reactivate({ agentId, expectedIdentityRevision: 2 });
    const updated = await management.updateConfig({
      agentId,
      config: { label: 'updated' },
      expectedRevision: 1,
    });
    const authority = fixture.authorityFor(agentId);
    const readIdentity = vi.spyOn(authority.identityCatalog, 'read');
    const readConfig = vi.spyOn(authority.config, 'read');

    await runtimes.open(agentId);

    const provisioning = fixture.createRuntimePorts.mock.calls[0]?.[0];
    expect(provisioning).toEqual({
      namespace: await fixture.namespacePort.resolve(agentId),
      identity: active.identity,
      config: updated.config,
    });
    expect(provisioning?.identity.revision).toBe(3);
    expect(provisioning?.config.revision).toBe(2);
    expect(Object.isFrozen(provisioning)).toBe(true);
    expect(Object.isFrozen(provisioning?.identity)).toBe(true);
    expect(Object.isFrozen(provisioning?.config)).toBe(true);
    const materialization = fixture.materialize.mock.calls[0]?.[0];
    expect(materialization).toEqual({
      identity: active.identity.identity,
      config: updated.config.value,
      ports: { slot: 1 },
    });
    expect(materialization?.identity).toBe(provisioning?.identity.identity);
    expect(materialization?.config).toBe(provisioning?.config.value);
    expect(readIdentity).toHaveBeenCalledTimes(1);
    expect(readConfig).toHaveBeenCalledTimes(1);
  });

  it('keeps one snapshot through pending provisioning while later opens see an update', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await management.create({ identity: { id: agentId }, config: { label: 'initial' } });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    fixture.createRuntimePorts.mockImplementationOnce(async ({ namespace }) => {
      entered.resolve();
      await release.promise;
      return Object.freeze({ slot: namespace.handle.slot });
    });

    const opening = runtimes.open(agentId);
    try {
      await Promise.race([entered.promise, opening]);
      await management.updateConfig({
        agentId,
        config: { label: 'updated' },
        expectedRevision: 1,
      });
      expect(fixture.materialize).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      await opening;
    }
    const first = await opening;
    const next = await runtimes.open(agentId);

    expect(first.resources).toEqual({ label: 'initial', slot: 1 });
    expect(next.resources).toEqual({ label: 'updated', slot: 1 });
    expect(next).not.toBe(first);
    expect(fixture.createRuntimePorts.mock.calls.map(([input]) => input.config)).toEqual([
      { revision: 1, value: { label: 'initial' } },
      { revision: 2, value: { label: 'updated' } },
    ]);
    for (const [index, [input]] of fixture.createRuntimePorts.mock.calls.entries()) {
      expect(fixture.materialize.mock.calls[index]?.[0].config).toBe(input.config.value);
    }
  });

  it('allows a synchronous profile factory to project Config into runtime ports', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const ports = vi.fn(
      ({ config }: Parameters<typeof fixture.definition.runtime.createPorts>[0]) =>
        Object.freeze({ label: config.value.label, revision: config.revision })
    );
    const definition = defineManagedAgentComposition({
      ...fixture.definition,
      runtime: {
        createPorts: ports,
        materialize: ({
          identity,
          config,
          ports: runtimePorts,
        }: ManagedAgentRuntimeMaterializationInput<
          TestManagedAgentConfig,
          ReturnType<typeof ports>
        >) => {
          return createAgent({
            identity,
            resources: Object.freeze({ label: config.label, provisioned: runtimePorts }),
            operations: Object.freeze({}),
          });
        },
      },
    });
    const management = createAgentManagementService(definition);
    const runtimes = createAgentRuntimeService(definition);
    expect(ports).not.toHaveBeenCalled();
    const agentId = parseAgentId('alpha');
    await management.create({ identity: { id: agentId }, config: { label: 'profile-config' } });

    const agent = await runtimes.open(agentId);

    expect(ports).toHaveBeenCalledTimes(1);
    expect(agent.resources).toEqual({
      label: 'profile-config',
      provisioned: { label: 'profile-config', revision: 1 },
    });
    expect(agent.resources.provisioned).toBe(ports.mock.results[0]?.value);
  });

  it('rejects invalid authoritative Config before provisioning or materialization', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await management.create({ identity: { id: agentId }, config: { label: 'initial' } });
    await fixture.authorityFor(agentId).config.write({
      agentId,
      schemaVersion: fixture.codec.schemaVersion,
      expectedRevision: 1,
      value: { wrongConfigShape: true },
    });

    await expect(runtimes.open(agentId)).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
  });
});
