import { parseAgentId } from '@ta-agent/base-identity';
import { describe, expect, it, vi } from 'vitest';
import { createAgentManagementService } from '../../src/index.js';
import { createManagedAgentFixture } from '../support/managed-agent-management.js';

describe('Agent Management Service cancellation', () => {
  it('stops Config mutation when cancellation arrives during namespace resolution', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: agentId }, config: { label: 'initial' } });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalResolve = fixture.namespacePort.resolve.bind(fixture.namespacePort);
    fixture.namespacePort.resolve = async (input) => {
      entered.resolve();
      await release.promise;
      return originalResolve(input);
    };
    const controller = new AbortController();

    const updating = service.updateConfig(
      { agentId, config: { label: 'cancelled' }, expectedRevision: 1 },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort(new Error('/private/cancellation/reason'));
    release.resolve();

    await expect(updating).rejects.toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_CANCELLED',
      operation: 'update-config',
    });
    await expect(service.inspect(agentId)).resolves.toMatchObject({
      config: { value: { label: 'initial' }, revision: 1 },
    });
    await updating.catch((failure: unknown) => {
      expect(String(failure)).not.toContain('/private');
    });
  });

  it('stops Identity transition when cancellation arrives during authority preparation', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: agentId }, config: { label: 'initial' } });
    const authority = fixture.authorityFor(agentId);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalRead = authority.config.read.bind(authority.config);
    vi.spyOn(authority.config, 'read').mockImplementation(async (input) => {
      entered.resolve();
      await release.promise;
      return originalRead(input);
    });
    const controller = new AbortController();

    const disabling = service.disable(
      { agentId, expectedIdentityRevision: 1 },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(disabling).rejects.toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_CANCELLED',
      operation: 'disable',
    });
    await expect(service.inspect(agentId)).resolves.toMatchObject({
      identity: { status: 'active', revision: 1 },
    });
  });

  it('aborts staged provisioning when cancellation arrives before namespace publication', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalStage = fixture.namespacePort.stage.bind(fixture.namespacePort);
    fixture.namespacePort.stage = async (input) => {
      entered.resolve();
      await release.promise;
      return originalStage(input);
    };
    const controller = new AbortController();

    const creating = service.create(
      { identity: { id: agentId }, config: { label: 'initial' } },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(creating).rejects.toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_CANCELLED',
      operation: 'create',
    });
    expect(fixture.events).toContain('namespace:abort:alpha');
    await expect(service.list()).resolves.toEqual([]);
  });

  it('returns the real commit when cancellation arrives after the adapter mutation begins', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: agentId }, config: { label: 'initial' } });
    const adapter = fixture.authorityFor(agentId).config;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const originalWrite = adapter.write.bind(adapter);
    vi.spyOn(adapter, 'write').mockImplementation(async (input) => {
      entered.resolve();
      await release.promise;
      return originalWrite(input);
    });
    const controller = new AbortController();

    const updating = service.updateConfig(
      { agentId, config: { label: 'committed' }, expectedRevision: 1 },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(updating).resolves.toMatchObject({
      status: 'committed',
      authority: { config: { value: { label: 'committed' }, revision: 2 } },
      projection: { kind: 'not-configured' },
    });
  });

  it('stops rename when cancellation arrives during its final Identity read', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({
      identity: { id: agentId, displayName: 'Original name' },
      config: { label: 'initial' },
    });
    const catalog = fixture.authorityFor(agentId).identityCatalog;
    const originalRead = catalog.read.bind(catalog);
    const originalRename = catalog.rename.bind(catalog);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let readCount = 0;
    vi.spyOn(catalog, 'read').mockImplementation(async (input) => {
      readCount += 1;
      if (readCount === 2) {
        entered.resolve();
        await release.promise;
      }
      return originalRead(input);
    });
    const rename = vi.spyOn(catalog, 'rename').mockImplementation(originalRename);
    const controller = new AbortController();

    const renaming = service.rename(
      {
        agentId,
        displayName: 'Cancelled name',
        expectedIdentityRevision: 1,
      },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(renaming).rejects.toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_CANCELLED',
      operation: 'rename',
    });
    expect(rename).not.toHaveBeenCalled();
    await expect(service.inspect(agentId)).resolves.toMatchObject({
      identity: {
        identity: { displayName: 'Original name' },
        revision: 1,
      },
    });
  });

  it('returns the real rename commit when cancellation arrives after rename begins', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({
      identity: { id: agentId, displayName: 'Original name' },
      config: { label: 'initial' },
    });
    const catalog = fixture.authorityFor(agentId).identityCatalog;
    const originalRename = catalog.rename.bind(catalog);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    vi.spyOn(catalog, 'rename').mockImplementation(async (input) => {
      entered.resolve();
      await release.promise;
      return originalRename(input);
    });
    const controller = new AbortController();

    const renaming = service.rename(
      {
        agentId,
        displayName: 'Committed name',
        expectedIdentityRevision: 1,
      },
      { signal: controller.signal }
    );
    await entered.promise;
    controller.abort();
    release.resolve();

    await expect(renaming).resolves.toMatchObject({
      status: 'committed',
      authority: {
        identity: {
          identity: { displayName: 'Committed name' },
          revision: 2,
        },
      },
      projection: { kind: 'not-configured' },
    });
  });

  it('validates options as a closed record without evaluating accessors', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    const getter = vi.fn(() => new AbortController().signal);
    const options = Object.defineProperty({}, 'signal', { enumerable: true, get: getter });

    await expect(service.inspect(agentId, options)).rejects.toMatchObject({
      code: 'MANAGED_AGENT_REQUEST_INVALID',
      operation: 'inspect',
    });
    expect(getter).not.toHaveBeenCalled();
  });
});
