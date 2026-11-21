import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
  createSessionNavigationService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { createMemorySessionPersistence } from '@print-an-agent/base-local-adapters';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { createStandaloneAgent, createStandaloneMemorySetup } from '../../../src/index.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../../support/resource-profile.js';

describe('caller-owned Memory setup', () => {
  it('lazily shares one real acquisition across Services and fresh raw Agents through Config changes', async () => {
    const released = vi.fn();
    const acquire = vi.fn(() => ({ value: createMemorySessionPersistence(), release: released }));
    const setup = createStandaloneMemorySetup({
      ...resourceProfileRuntimeOptions(() => undefined),
      acquireSessionPersistence: acquire,
    });
    onTestFinished(() => setup.close());
    const agents = createAgentManagementService(setup.definition);
    const sessions = createSessionManagementService(setup.definition);
    const navigation = createSessionNavigationService(setup.definition);
    const runtimes = createAgentRuntimeService(setup.definition);
    expect(acquire).not.toHaveBeenCalled();
    const created = await agents.create({
      identity: { id: 'owned' },
      config: resourceProfileConfig(),
    });
    const agentId = created.authority.identity.identity.id;
    expect(acquire).not.toHaveBeenCalled();
    await sessions.list({ agentId });
    const [first, second] = await Promise.all([runtimes.open(agentId), runtimes.open(agentId)]);
    expect(first).not.toBe(second);
    expect(first.resources.session).toBe(second.resources.session);
    expect(first.resources.requestJournal).toBe(second.resources.requestJournal);
    expect(first).not.toHaveProperty('close');
    expect(first).not.toHaveProperty('setup');
    const response = await first.invoke('foreground', { message: 'hello' });
    await expect(
      navigation.inspect({ agentId, sessionId: response.sessionId })
    ).resolves.toMatchObject({ status: 'inspected' });
    await agents.updateConfig({
      agentId,
      expectedRevision: 1,
      config: resourceProfileConfig('Changed'),
    });
    expect((await runtimes.open(agentId)).resources.session).toBe(first.resources.session);
    await expect(
      agents.updateConfig({ agentId, expectedRevision: 1, config: resourceProfileConfig() })
    ).rejects.toMatchObject({ code: 'CONFIG_REVISION_CONFLICT' });
    await agents.disable({ agentId, expectedIdentityRevision: 1 });
    await expect(runtimes.open(agentId)).rejects.toBeDefined();
    await expect(
      sessions.listTurns({ agentId, sessionId: response.sessionId })
    ).resolves.toMatchObject({ records: [{ status: 'completed' }] });
    await agents.reactivate({ agentId, expectedIdentityRevision: 2 });
    expect((await runtimes.open(agentId)).resources.requestJournal).toBe(
      first.resources.requestJournal
    );
    expect(acquire).toHaveBeenCalledOnce();
    expect(released).not.toHaveBeenCalled();
    // Business execution is joined above; the explicit owner can now release the allocation.
    await setup.close();
    await setup.close();
    expect(released).toHaveBeenCalledOnce();
    await expect(runtimes.open(agentId)).rejects.toBeDefined();
    await expect(sessions.list({ agentId })).rejects.toBeDefined();
  });

  it('retains published authority and an explicit cleanup owner when raw Agent opening fails', async () => {
    const released = vi.fn();
    const setup = createStandaloneMemorySetup({
      readEnvironmentVariable: () => undefined,
      acquireSessionPersistence: () => ({
        value: createMemorySessionPersistence(),
        release: released,
      }),
    });
    onTestFinished(() => setup.close());
    const config = {
      provider: {
        config: {
          kind: 'builtin' as const,
          reference: {
            provider: 'missing-provider',
            model: 'missing-model',
            credentialRef: 'missing',
          },
        },
      },
      credential: { reference: 'missing', environmentVariable: 'UNAVAILABLE' },
    };
    await expect(
      createStandaloneAgent(setup, { identity: { id: 'published' }, config })
    ).rejects.toBeDefined();
    expect(
      (await createAgentManagementService(setup.definition).inspect(parseAgentId('published')))
        .config.revision
    ).toBe(1);
    await setup.close();
    expect(released).toHaveBeenCalledOnce();
  });

  it('uses separate allocations even when identical Agent IDs are created in distinct setups', async () => {
    const options = resourceProfileRuntimeOptions(() => undefined);
    const a = createStandaloneMemorySetup(options);
    const b = createStandaloneMemorySetup(options);
    onTestFinished(() => a.close());
    onTestFinished(() => b.close());
    const input = { identity: { id: 'same' }, config: resourceProfileConfig() };
    const [first, second] = await Promise.all([
      createStandaloneAgent(a, input),
      createStandaloneAgent(b, input),
    ]);
    expect(first.resources.session).not.toBe(second.resources.session);
    await expect(createStandaloneAgent(a, input)).rejects.toMatchObject({
      code: 'MANAGED_AGENT_ALREADY_EXISTS',
    });
  });
});
