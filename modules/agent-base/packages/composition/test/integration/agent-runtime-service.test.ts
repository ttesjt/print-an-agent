import { parseAgentId } from '@print-an-agent/base-identity';
import { Agent, createAgent } from '@print-an-agent/base-runtime';
import { describe, expect, it } from 'vitest';
import {
  AgentManagementError,
  createAgentManagementService,
  createAgentRuntimeService,
} from '../../src/index.js';
import { createManagedAgentFixture } from '../support/managed-agent-management.js';

describe('Agent Runtime Service', () => {
  it('is zero-I/O until open and returns the exact independently materialized raw Agent', async () => {
    const fixture = createManagedAgentFixture();
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);

    expect(Object.isFrozen(runtimes)).toBe(true);
    expect(fixture.events).toEqual([]);

    await management.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.events.splice(0);
    fixture.projectionPublish.mockClear();
    fixture.projectionReconcile.mockClear();

    const agent = await runtimes.open(parseAgentId('alpha'));

    expect(agent).toBeInstanceOf(Agent);
    expect(agent).toBe(fixture.materialize.mock.results[0]?.value);
    expect(Object.isFrozen(fixture.materialize.mock.calls[0]?.[0])).toBe(true);
    expect(agent.identity).toEqual({ id: 'alpha', displayName: 'alpha' });
    expect(agent.resources).toEqual({ label: 'initial', slot: 1 });
    expect(fixture.events).toEqual([
      'authority:ports:1',
      'runtime:ports:1',
      'runtime:materialize:alpha:initial:1',
    ]);
    expect(fixture.projectionPublish).not.toHaveBeenCalled();
    expect(fixture.projectionReconcile).not.toHaveBeenCalled();
  });

  it('does not cache Agents and observes Config changes only on later opens', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);

    await management.create({ identity: { id: 'alpha' }, config: { label: 'alpha-v1' } });
    await management.create({ identity: { id: 'bravo' }, config: { label: 'bravo-v1' } });

    const alphaV1 = await runtimes.open(parseAgentId('alpha'));
    const bravo = await runtimes.open(parseAgentId('bravo'));
    await management.updateConfig({
      agentId: parseAgentId('alpha'),
      config: { label: 'alpha-v2' },
      expectedRevision: 1,
    });
    const alphaV2 = await runtimes.open(parseAgentId('alpha'));

    expect(alphaV1).not.toBe(alphaV2);
    expect(alphaV1.resources).toEqual({ label: 'alpha-v1', slot: 1 });
    expect(alphaV2.resources).toEqual({ label: 'alpha-v2', slot: 1 });
    expect(bravo.resources).toEqual({ label: 'bravo-v1', slot: 2 });
    expect(fixture.createRuntimePorts).toHaveBeenCalledTimes(3);
    expect(fixture.materialize).toHaveBeenCalledTimes(3);
  });

  it('rejects missing and disabled Agents before creating runtime resources', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);

    await expect(runtimes.open(parseAgentId('missing'))).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NOT_FOUND',
      operation: 'open',
    });

    const created = await management.create({
      identity: { id: 'alpha' },
      config: { label: 'initial' },
    });
    await management.disable({
      agentId: parseAgentId('alpha'),
      expectedIdentityRevision: created.authority.identity.revision,
    });

    await expect(runtimes.open(parseAgentId('alpha'))).rejects.toMatchObject({
      code: 'MANAGED_AGENT_DISABLED',
      operation: 'open',
    });
    expect(fixture.createRuntimePorts).not.toHaveBeenCalled();
    expect(fixture.materialize).not.toHaveBeenCalled();
  });

  it('fails closed when a materializer returns a facade instead of a raw Agent', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);
    await management.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.controls.materializedValueOverride = Object.freeze({
      value: Object.freeze({ invoke: () => Promise.resolve(undefined) }),
    });

    await expect(runtimes.open(parseAgentId('alpha'))).rejects.toMatchObject({
      code: 'MANAGED_AGENT_RUNTIME_INVALID',
      operation: 'open',
      message: 'Managed Agent runtime materializer must return a raw Agent.',
    });
  });

  it('fails closed when the materialized Agent does not own the authoritative Identity', async () => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);
    await management.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.controls.materializedValueOverride = Object.freeze({
      value: createAgent({
        identity: { id: parseAgentId('bravo'), displayName: 'Bravo' },
        resources: Object.freeze({}),
        operations: Object.freeze({}),
      }),
    });

    await expect(runtimes.open(parseAgentId('alpha'))).rejects.toMatchObject({
      code: 'MANAGED_AGENT_RUNTIME_INVALID',
      operation: 'open',
      message: 'Managed Agent runtime materializer returned an Agent with a different Identity.',
    });
  });

  it.each([
    ['runtime Port factory', 'runtimePortsFailure'],
    ['runtime materializer', 'materializationFailure'],
  ] as const)('sanitizes a raw %s failure', async (_label, failureControl) => {
    const fixture = createManagedAgentFixture({ projection: false });
    const management = createAgentManagementService(fixture.definition);
    const runtimes = createAgentRuntimeService(fixture.definition);
    await management.create({ identity: { id: 'alpha' }, config: { label: 'initial' } });
    fixture.controls[failureControl] = new Error('/private/runtime/path SELECT credential');

    let failure: unknown;
    try {
      await runtimes.open(parseAgentId('alpha'));
    } catch (cause: unknown) {
      failure = cause;
    }

    expect(failure).toBeInstanceOf(AgentManagementError);
    expect(failure).toMatchObject({
      code: 'MANAGED_AGENT_OPERATION_FAILED',
      operation: 'open',
      message: 'Managed Agent runtime opening failed.',
    });
    expect(String(failure)).not.toContain('/private');
    expect(String(failure)).not.toContain('credential');
  });
});
