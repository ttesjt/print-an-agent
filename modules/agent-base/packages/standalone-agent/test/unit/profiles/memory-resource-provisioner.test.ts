import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { createMemorySessionPersistence } from '@print-an-agent/base-local-adapters';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStandaloneResourceProvisioner } from '../../../src/profiles/memory/resources/provisioner.js';

vi.mock('@print-an-agent/base-local-adapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@print-an-agent/base-local-adapters')>();
  return {
    ...actual,
    createMemorySessionPersistence: vi.fn(actual.createMemorySessionPersistence),
  };
});

async function expectNamespaceFailure(
  operation: () => unknown,
  code: 'STANDALONE_AGENT_STORAGE_INVALID' | 'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS'
): Promise<void> {
  await expect(Promise.resolve().then(operation)).rejects.toMatchObject({ code });
}

describe('Memory profile resource ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps allocation, authority and coordinated persistence independently lazy', async () => {
    const clock = vi.fn(() => 100);
    const resources = createMemoryStandaloneResourceProvisioner({ clock });
    expect(clock).not.toHaveBeenCalled();
    expect(createMemorySessionPersistence).not.toHaveBeenCalled();
    expect(await resources.namespacePort.list()).toEqual([]);
    const staged = await resources.namespacePort.stage(parseAgentId('alpha'));
    const authority = resources.createAuthorityPorts(staged);
    expect(resources.createAuthorityPorts(staged)).toBe(authority);
    expect(createMemorySessionPersistence).not.toHaveBeenCalled();
    const published = await resources.namespacePort.publish(staged);

    const first = await resources.createSessionManagementPorts(published);
    const second = await resources.createSessionManagementPorts(published);
    const navigation = await resources.createSessionNavigationPorts(published);

    expect(createMemorySessionPersistence).toHaveBeenCalledOnce();
    expect(first.session).toBe(second.session);
    expect(navigation.session).toBe(first.session);
    expect(first.maintenance).toBe(second.maintenance);
    expect(resources.createAuthorityPorts(published)).toBe(authority);
    expect(clock).not.toHaveBeenCalled();
  });

  it('keeps staged allocations private and reserves an Agent ID exclusively', async () => {
    const resources = createMemoryStandaloneResourceProvisioner({});
    const agentId = parseAgentId('alpha');
    const staged = await resources.namespacePort.stage(agentId);
    expect(staged.resumed).toBe(false);
    expect(await resources.namespacePort.resolve(agentId)).toBeUndefined();
    expect(await resources.namespacePort.list()).toEqual([]);
    await expectNamespaceFailure(
      () => resources.createSessionManagementPorts({ ...staged, phase: 'published' }),
      'STANDALONE_AGENT_STORAGE_INVALID'
    );
    await expectNamespaceFailure(
      () => resources.createSessionNavigationPorts({ ...staged, phase: 'published' }),
      'STANDALONE_AGENT_STORAGE_INVALID'
    );
    await expectNamespaceFailure(
      () => resources.namespacePort.stage(agentId),
      'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS'
    );
    const published = await resources.namespacePort.publish(staged);
    expect(await resources.namespacePort.resolve(agentId)).toBe(published);
    expect(await resources.namespacePort.list()).toEqual([published]);
    await expectNamespaceFailure(
      () => resources.namespacePort.stage(agentId),
      'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS'
    );
    await expectNamespaceFailure(
      () => resources.namespacePort.abort(staged),
      'STANDALONE_AGENT_STORAGE_INVALID'
    );
    expect(await resources.namespacePort.resolve(agentId)).toBe(published);
  });

  it('drops failed allocations and rejects stale or foreign handles without harming replacements', async () => {
    const resources = createMemoryStandaloneResourceProvisioner({});
    const foreign = createMemoryStandaloneResourceProvisioner({});
    const agentId = parseAgentId('alpha');
    const old = await resources.namespacePort.stage(agentId);
    const oldAuthority = resources.createAuthorityPorts(old);
    await resources.namespacePort.abort(old);
    const replacement = await resources.namespacePort.stage(agentId);
    const otherScope = await foreign.namespacePort.stage(agentId);

    expect(resources.createAuthorityPorts(replacement)).not.toBe(oldAuthority);
    for (const invalid of [old, otherScope, { ...replacement, agentId: parseAgentId('other') }]) {
      await expectNamespaceFailure(
        () => resources.createAuthorityPorts(invalid),
        'STANDALONE_AGENT_STORAGE_INVALID'
      );
      await expectNamespaceFailure(
        () => resources.namespacePort.publish(invalid),
        'STANDALONE_AGENT_STORAGE_INVALID'
      );
      await expectNamespaceFailure(
        () => resources.namespacePort.abort(invalid),
        'STANDALONE_AGENT_STORAGE_INVALID'
      );
    }
    const published = await resources.namespacePort.publish(replacement);
    expect(await resources.namespacePort.resolve(agentId)).toBe(published);
    await expectNamespaceFailure(
      () => resources.createSessionManagementPorts({ ...otherScope, phase: 'published' }),
      'STANDALONE_AGENT_STORAGE_INVALID'
    );
    await expectNamespaceFailure(
      () => resources.createSessionNavigationPorts({ ...otherScope, phase: 'published' }),
      'STANDALONE_AGENT_STORAGE_INVALID'
    );
    expect(createMemorySessionPersistence).not.toHaveBeenCalled();
  });
});
