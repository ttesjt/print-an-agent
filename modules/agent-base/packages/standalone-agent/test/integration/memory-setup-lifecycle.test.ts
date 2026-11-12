import {
  createAgentManagementService,
  createAgentRuntimeService,
  createSessionManagementService,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity';
import { createMemorySessionPersistence } from '@print-an-agent/base-local-adapters';
import { ResourceCleanupError } from '@print-an-agent/base-composition/resource-registry';
import { describe, expect, it, vi } from 'vitest';
import { createStandaloneAgent, createStandaloneMemorySetup } from '../../src/index.js';
import {
  resourceProfileConfig,
  resourceProfileRuntimeOptions,
} from '../support/resource-profile.js';

describe('Memory setup lifecycle failure windows', () => {
  it('rejects malformed acquisition wiring before any authority is provisioned', () => {
    expect(() =>
      createStandaloneMemorySetup({
        readEnvironmentVariable: () => undefined,
        // @ts-expect-error Untyped hosts cannot install malformed authority recipes.
        acquireAuthority: 'invalid',
      })
    ).toThrow('Memory authority acquisition must be a function.');
    expect(() =>
      createStandaloneMemorySetup({
        readEnvironmentVariable: () => undefined,
        // @ts-expect-error Runtime JavaScript must not defer this invalid recipe until open().
        acquireSessionPersistence: 'invalid',
      })
    ).toThrow('Memory persistence acquisition must be a function.');
  });
  it('does not close setup admission for invalid shutdown input', async () => {
    const setup = createStandaloneMemorySetup(resourceProfileRuntimeOptions(() => undefined));
    // @ts-expect-error Exercise the untyped runtime boundary before there are allocations.
    await expect(setup.close({ mode: 'invalid' })).rejects.toMatchObject({
      code: 'STANDALONE_CONFIG_INVALID',
    });
    await createStandaloneAgent(setup, {
      identity: { id: 'still-open' },
      config: resourceProfileConfig(),
    });
    await setup.close();
  });
  it('joins a cancelled acquisition and releases its late result instead of materializing a raw Agent', async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const release = vi.fn();
    let signal: AbortSignal | undefined;
    const setup = createStandaloneMemorySetup({
      ...resourceProfileRuntimeOptions(() => undefined),
      acquireSessionPersistence: async (input) => {
        signal = input.signal;
        started.resolve();
        await gate.promise;
        return { value: createMemorySessionPersistence(), release };
      },
    });
    const created = await createAgentManagementService(setup.definition).create({
      identity: { id: 'pending' },
      config: resourceProfileConfig(),
    });
    const opening = createAgentRuntimeService(setup.definition).open(
      created.authority.identity.identity.id
    );
    const rejected = expect(opening).rejects.toBeDefined();
    await started.promise;
    let closed = false;
    const closing = setup.close({ mode: 'abort' }).then(() => {
      closed = true;
    });
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(release).not.toHaveBeenCalled();
    gate.resolve();
    await rejected;
    await closing;
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps failed initialization cleanup in the real Profile owner and still closes other allocations', async () => {
    const failure = new ResourceCleanupError({
      primary: new Error('Worker initialization failed'),
      failures: [new Error('Unwind not confirmed')],
    });
    const healthyRelease = vi.fn();
    const setup = createStandaloneMemorySetup({
      ...resourceProfileRuntimeOptions(() => undefined),
      acquireSessionPersistence: ({ agentId }) => {
        if (agentId === 'broken') throw failure;
        return { value: createMemorySessionPersistence(), release: healthyRelease };
      },
    });
    const agents = createAgentManagementService(setup.definition);
    for (const id of ['broken', 'healthy'])
      await agents.create({ identity: { id }, config: resourceProfileConfig() });
    const sessions = createSessionManagementService(setup.definition);
    await sessions.list({ agentId: parseAgentId('healthy') });
    await expect(sessions.list({ agentId: parseAgentId('broken') })).rejects.toBeDefined();
    // Runtime-resource fencing must not erase committed, independently owned authority.
    expect((await agents.inspect(parseAgentId('broken'))).config.revision).toBe(1);
    await expect(
      agents.create({ identity: { id: 'broken' }, config: resourceProfileConfig() })
    ).rejects.toMatchObject({ code: 'MANAGED_AGENT_ALREADY_EXISTS' });
    const closing = setup.close();
    await expect(closing).rejects.toMatchObject({
      code: 'RESOURCE_CLEANUP_FAILED',
      failures: [{ failures: [failure] }],
    });
    expect(healthyRelease).toHaveBeenCalledOnce();
    expect(setup.close({ mode: 'abort' })).toBe(closing);
    expect(healthyRelease).toHaveBeenCalledOnce();
  });

  it('joins business execution before shutdown and keeps its committed response when release fails', async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let joined = false;
    const release = vi.fn(() => {
      expect(joined).toBe(true);
      throw new Error('Resource release failed after commit');
    });
    const base = resourceProfileRuntimeOptions(() => undefined);
    const continuation = base.stepOverrides?.invokeActorInteraction;
    const setup = createStandaloneMemorySetup({
      ...base,
      acquireSessionPersistence: () => ({ value: createMemorySessionPersistence(), release }),
      stepOverrides: {
        invokeActorInteraction: async (context) => {
          started.resolve();
          await gate.promise;
          if (typeof continuation !== 'function') throw new Error('Expected the real fixture Step');
          await continuation(context);
        },
      },
    });
    const agent = await createStandaloneAgent(setup, {
      identity: { id: 'running' },
      config: resourceProfileConfig(),
    });
    const execution = agent.invoke('foreground', { message: 'real pending business call' });
    await started.promise;
    // The Host, not Registry, owns this join. It does not release a live Run's persistence.
    const shutdown = async () => {
      const response = await execution;
      joined = true;
      await expect(
        createSessionManagementService(setup.definition).listTurns({
          agentId: agent.identity.id,
          sessionId: response.sessionId,
        })
      ).resolves.toMatchObject({ records: [{ status: 'completed' }] });
      await expect(setup.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
      return response;
    };
    const closing = shutdown();
    expect(release).not.toHaveBeenCalled();
    gate.resolve();
    const response = await closing;
    expect(response).toBe(await execution);
    expect(response.sessionId.length).toBeGreaterThan(0);
    expect(release).toHaveBeenCalledOnce();
    await expect(setup.close()).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
  });
});
