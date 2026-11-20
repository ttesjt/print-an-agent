import { AgentConfigError } from '@print-an-agent/base-identity-config/config';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { describe, expect, it, vi } from 'vitest';
import { createAgentManagementService } from '../../src/index.js';
import { createManagedAgentFixture } from '../support/managed-agent-management.js';

describe('Agent Management Service authority mutations', () => {
  it('renames metadata through identity CAS and preserves Config and namespace', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: agentId }, config: { label: 'unchanged' } });
    const renamed = await service.rename({
      agentId,
      expectedIdentityRevision: 1,
      displayName: 'Alpha renamed',
    });
    expect(renamed).toMatchObject({
      status: 'committed',
      operation: 'rename',
      authority: {
        identity: {
          identity: { id: agentId, displayName: 'Alpha renamed' },
          revision: 2,
          status: 'active',
        },
        config: { revision: 1, value: { label: 'unchanged' } },
      },
    });
    await expect(
      service.rename({ agentId, expectedIdentityRevision: 1, displayName: 'Stale' })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_REVISION_CONFLICT' });
    expect(fixture.materialize).not.toHaveBeenCalled();
    fixture.controls.projectionReconcileFailure = new Error('private projection');
    await expect(
      service.rename({ agentId, expectedIdentityRevision: 2, displayName: 'Committed' })
    ).resolves.toMatchObject({
      status: 'committed',
      authority: { identity: { identity: { displayName: 'Committed' }, revision: 3 } },
      projection: {
        kind: 'failed',
        failure: { code: 'MANAGED_AGENT_PROJECTION_FAILED' },
      },
    });
    fixture.controls.projectionReconcileFailure = undefined;
    expect((await service.inspect(agentId)).identity.identity.displayName).toBe('Committed');
  });
  it('updates typed Config with CAS and preserves a committed update across Projection failure', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.controls.projectionReconcileFailure = new Error('/private/projection/path');

    await expect(
      service.updateConfig({ agentId, config: { label: 'updated' }, expectedRevision: 1 })
    ).resolves.toMatchObject({
      status: 'committed',
      operation: 'update-config',
      authority: { config: { value: { label: 'updated' }, revision: 2 } },
      projection: {
        kind: 'failed',
        failure: { code: 'MANAGED_AGENT_PROJECTION_FAILED' },
      },
    });

    fixture.controls.projectionReconcileFailure = undefined;
    await expect(service.inspect(agentId)).resolves.toMatchObject({
      config: { value: { label: 'updated' }, revision: 2 },
    });
    await expect(
      service.updateConfig({ agentId, config: { label: 'stale' }, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'CONFIG_REVISION_CONFLICT' });
  });

  it('returns the exact Config commit even when a later write wins before Projection settles', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: agentId }, config: { label: 'initial' } });
    const projectionEntered = Promise.withResolvers<void>();
    const releaseProjection = Promise.withResolvers<void>();
    fixture.projectionReconcile.mockImplementationOnce(async () => {
      projectionEntered.resolve();
      await releaseProjection.promise;
      throw new Error('/private/projection/path');
    });

    const first = service.updateConfig({
      agentId,
      config: { label: 'first' },
      expectedRevision: 1,
    });
    await projectionEntered.promise;
    await expect(
      service.updateConfig({ agentId, config: { label: 'second' }, expectedRevision: 2 })
    ).resolves.toMatchObject({ authority: { config: { revision: 3 } } });
    releaseProjection.resolve();

    await expect(first).resolves.toMatchObject({
      status: 'committed',
      operation: 'update-config',
      authority: { config: { value: { label: 'first' }, revision: 2 } },
      projection: {
        kind: 'failed',
        failure: { code: 'MANAGED_AGENT_PROJECTION_FAILED' },
      },
    });
  });

  it('decodes unknown Config input before I/O and imports through the same CAS path', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    const resolve = vi.spyOn(fixture.namespacePort, 'resolve');
    resolve.mockClear();

    await expect(
      service.importConfig({ agentId, input: { label: '', extra: true }, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    expect(resolve).not.toHaveBeenCalled();

    await expect(
      service.importConfig({ agentId, input: { label: 'imported' }, expectedRevision: 1 })
    ).resolves.toMatchObject({
      status: 'committed',
      operation: 'import-config',
      authority: { config: { value: { label: 'imported' }, revision: 2 } },
    });
  });

  it('disables, updates, and reactivates an Agent without materializing runtime state', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    const created = await service.create({
      identity: { id: 'alpha' },
      config: { label: 'initial' },
    });

    const disabled = await service.disable({
      agentId,
      expectedIdentityRevision: created.authority.identity.revision,
    });
    expect(disabled.authority.identity).toMatchObject({ status: 'disabled', revision: 2 });

    await expect(
      service.updateConfig({ agentId, config: { label: 'while-disabled' }, expectedRevision: 1 })
    ).resolves.toMatchObject({ authority: { config: { revision: 2 } } });
    await expect(
      service.reactivate({
        agentId,
        expectedIdentityRevision: disabled.authority.identity.revision,
      })
    ).resolves.toMatchObject({ authority: { identity: { status: 'active', revision: 3 } } });
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it('preserves stable Config errors while removing their underlying cause', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);

    let failure: unknown;
    try {
      await service.create({ identity: { id: 'alpha' }, config: { label: '' } });
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(AgentConfigError);
    expect(failure).toMatchObject({ code: 'CONFIG_INVALID' });
    expect((failure as Error).cause).toBeUndefined();
  });

  it('sanitizes unknown adapter failures', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const service = createAgentManagementService(fixture.definition);
    fixture.namespacePort.resolve = () =>
      Promise.reject(new Error('/private/agents.sqlite: SELECT credential FROM secrets'));

    let failure: unknown;
    try {
      await service.inspect(parseAgentId('alpha'));
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_FAILED',
      operation: 'inspect',
    });
    expect(String(failure)).not.toContain('/private');
    expect(String(failure)).not.toContain('credential');
    expect((failure as Error).cause).toBeUndefined();
  });
});
