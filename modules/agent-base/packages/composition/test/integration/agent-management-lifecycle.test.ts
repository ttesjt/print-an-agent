import { createAgentIdentity, parseAgentId } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  AgentManagementError,
  createAgentManagementService,
  type ManagedAgentNamespace,
} from '../../src/index.js';
import { createManagedAgentFixture } from '../support/managed-agent-management.js';

describe('Agent Management Service lifecycle', () => {
  it('creates a service without I/O and provisions an Agent in lifecycle order', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);

    expect(Object.isFrozen(service)).toBe(true);
    expect(fixture.events).toEqual([]);

    const created = await service.create({
      identity: { id: 'alpha', displayName: 'Alpha' },
      config: { label: 'initial' },
    });

    expect(created).toMatchObject({
      identity: { identity: { id: 'alpha', displayName: 'Alpha' }, status: 'active', revision: 1 },
      config: { value: { label: 'initial' }, revision: 1 },
      projection: { kind: 'not-configured' },
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.config)).toBe(true);
    expect(fixture.events).toEqual([
      'namespace:stage:alpha',
      'authority:ports:1',
      'namespace:publish:alpha',
    ]);
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it('publishes the namespace before its recoverable Projection and reconciles inspection', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);

    await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.controls.projectionStatus = 'stale';
    const inspected = await service.inspect(parseAgentId('alpha'));

    expect(fixture.events).toEqual([
      'namespace:stage:alpha',
      'authority:ports:1',
      'namespace:publish:alpha',
      'projection:publish:alpha',
      'authority:ports:1',
      'projection:reconcile:alpha',
    ]);
    expect(inspected.projection).toEqual({ kind: 'stale' });
  });

  it('resumes partial staged authority only when its initial Identity matches', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');

    await fixture.stage(agentId);
    await createAgentIdentity({
      identity: { id: agentId, displayName: 'Alpha' },
      catalog: fixture.authorityFor(agentId).identityCatalog,
    });

    await expect(
      service.create({
        identity: { id: 'alpha', displayName: 'Alpha' },
        config: { label: 'initial' },
      })
    ).resolves.toMatchObject({ config: { revision: 1 } });
    await expect(service.inspect(agentId)).resolves.toMatchObject({
      identity: { identity: { displayName: 'Alpha' } },
      config: { value: { label: 'initial' } },
    });
  });

  it('rejects conflicting staged authority and aborts the unpublished namespace', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');

    await fixture.stage(agentId);
    await createAgentIdentity({
      identity: { id: agentId, displayName: 'Different Identity' },
      catalog: fixture.authorityFor(agentId).identityCatalog,
    });

    await expect(
      service.create({
        identity: { id: 'alpha', displayName: 'Alpha' },
        config: { label: 'initial' },
      })
    ).rejects.toMatchObject({
      code: 'MANAGED_AGENT_PROVISIONING_CONFLICT',
      operation: 'create',
    });
    expect(fixture.events).toContain('namespace:abort:alpha');
    await expect(service.inspect(agentId)).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NOT_FOUND',
    });
  });

  it('aborts an unpublished namespace when its atomic publication fails', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);
    fixture.controls.namespacePublishFailure = new Error('/private/namespace/path');

    await expect(
      service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } })
    ).rejects.toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_FAILED',
      operation: 'create',
    });
    expect(fixture.events).toEqual([
      'namespace:stage:alpha',
      'authority:ports:1',
      'namespace:publish:alpha',
      'namespace:abort:alpha',
    ]);
    expect(fixture.projectionPublish).not.toHaveBeenCalled();
    await expect(service.inspect(parseAgentId('alpha'))).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NOT_FOUND',
    });
  });

  it('keeps a published Agent recoverable when initial Projection publication fails', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);
    fixture.controls.projectionPublishFailure = new Error('/private/projection/path');

    await expect(
      service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } })
    ).rejects.toMatchObject({
      name: 'AgentManagementError',
      code: 'MANAGED_AGENT_PROJECTION_FAILED',
      operation: 'create',
    });
    expect(fixture.events).not.toContain('namespace:abort:alpha');
    fixture.controls.projectionPublishFailure = undefined;
    await expect(service.inspect(parseAgentId('alpha'))).resolves.toMatchObject({
      projection: { kind: 'current' },
    });
  });

  it('reports safe structured summaries when provisioning and cleanup both fail', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');

    await fixture.stage(agentId);
    await createAgentIdentity({
      identity: { id: agentId, displayName: 'Different Identity' },
      catalog: fixture.authorityFor(agentId).identityCatalog,
    });
    fixture.controls.abortFailure = new Error('DELETE FROM secret_table');

    let failure: unknown;
    try {
      await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(AgentManagementError);
    expect(failure).toMatchObject({
      code: 'MANAGED_AGENT_PROVISIONING_CLEANUP_FAILED',
      failures: [
        { domain: 'management', code: 'MANAGED_AGENT_PROVISIONING_CONFLICT' },
        { domain: 'unexpected', code: 'UNEXPECTED_FAILURE' },
      ],
    });
    expect(String(failure)).not.toContain('secret_table');
  });

  it('maps an atomic duplicate namespace reservation to a stable conflict', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);

    await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });

    await expect(
      service.create({ identity: { id: 'alpha' }, config: { label: 'replacement' } })
    ).rejects.toMatchObject({
      name: 'AgentManagementError',
      code: 'MANAGED_AGENT_ALREADY_EXISTS',
      operation: 'create',
      message: 'Managed Agent already exists.',
    });
    expect(fixture.events.filter((event) => event === 'namespace:stage:alpha')).toHaveLength(2);
  });

  it('sorts namespace results deterministically and rejects duplicate Agent IDs', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    await service.create({ identity: { id: 'bravo' }, config: { label: 'b' } });
    await service.create({ identity: { id: 'alpha' }, config: { label: 'a' } });
    const original = await fixture.namespacePort.list();
    fixture.controls.listedNamespaces = Object.freeze([...original].reverse());

    expect((await service.list()).map((snapshot) => snapshot.identity.identity.id)).toEqual([
      'alpha',
      'bravo',
    ]);

    const first = original[0];
    if (first === undefined) throw new Error('Expected a namespace fixture.');
    fixture.controls.listedNamespaces = Object.freeze([first, first]);
    await expect(service.list()).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NAMESPACE_INVALID',
      operation: 'list',
    });
  });

  it('fails closed when a namespace resolves authority for another Agent ID', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    const resolved = await fixture.namespacePort.resolve(parseAgentId('alpha'));
    if (resolved === undefined) throw new Error('Expected a published namespace fixture.');
    fixture.namespacePort.resolve = () =>
      Promise.resolve(
        Object.freeze({
          ...resolved,
          agentId: parseAgentId('bravo'),
        }) as ManagedAgentNamespace<{ readonly slot: number }>
      );

    await expect(service.inspect(parseAgentId('alpha'))).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NAMESPACE_INVALID',
    });
  });
});
