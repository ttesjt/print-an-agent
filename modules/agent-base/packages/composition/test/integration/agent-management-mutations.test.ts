import { AgentConfigError } from '@ta-agent/base-config';
import { parseAgentId } from '@ta-agent/base-identity';
import { describe, expect, it, vi } from 'vitest';
import { createAgentManagementService } from '../../src/index.js';
import { createManagedAgentFixture } from '../support/managed-agent-management.js';

describe('Agent Management Service authority mutations', () => {
  it('updates typed Config with CAS and preserves a committed update across Projection failure', async () => {
    const fixture = createManagedAgentFixture();
    const service = createAgentManagementService(fixture.definition);
    const agentId = parseAgentId('alpha');
    await service.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.controls.projectionReconcileFailure = new Error('/private/projection/path');

    await expect(
      service.updateConfig({ agentId, config: { label: 'updated' }, expectedRevision: 1 })
    ).rejects.toMatchObject({
      code: 'MANAGED_AGENT_PROJECTION_FAILED',
      operation: 'update-config',
    });

    fixture.controls.projectionReconcileFailure = undefined;
    await expect(service.inspect(agentId)).resolves.toMatchObject({
      config: { value: { label: 'updated' }, revision: 2 },
    });
    await expect(
      service.updateConfig({ agentId, config: { label: 'stale' }, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: 'CONFIG_REVISION_CONFLICT' });
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
      config: { value: { label: 'imported' }, revision: 2 },
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
      expectedIdentityRevision: created.identity.revision,
    });
    expect(disabled.identity).toMatchObject({ status: 'disabled', revision: 2 });

    await expect(
      service.updateConfig({ agentId, config: { label: 'while-disabled' }, expectedRevision: 1 })
    ).resolves.toMatchObject({ config: { revision: 2 } });
    await expect(
      service.reactivate({ agentId, expectedIdentityRevision: disabled.identity.revision })
    ).resolves.toMatchObject({ identity: { status: 'active', revision: 3 } });
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
