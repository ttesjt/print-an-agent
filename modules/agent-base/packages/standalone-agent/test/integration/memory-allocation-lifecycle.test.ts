import {
  createAgentManagementService,
  defineManagedAgentComposition,
  type ManagedAgentAuthorityPorts,
} from '@print-an-agent/base-composition';
import { parseAgentId } from '@print-an-agent/base-identity';
import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
} from '@print-an-agent/base-local-adapters';
import { ResourceCleanupError } from '@print-an-agent/base-composition/resource-registry';
import { expect, it, vi } from 'vitest';
import { createStandaloneMemorySetup } from '../../src/index.js';
import { resourceProfileConfig } from '../support/resource-profile.js';

function authority(): ManagedAgentAuthorityPorts {
  return {
    identityCatalog: new MemoryAgentIdentityCatalogAdapter(),
    config: new MemoryAgentConfigAdapter(),
  };
}

it('prepares authority before delivery, uses fresh allocation authority after abort and rejects stale handles', async () => {
  const allocations: { id: string; release: ReturnType<typeof vi.fn> }[] = [];
  const setup = createStandaloneMemorySetup({
    readEnvironmentVariable: () => undefined,
    acquireAuthority: ({ allocationId }) => {
      const release = vi.fn();
      allocations.push({ id: allocationId, release });
      return { value: authority(), release };
    },
  });
  expect(allocations).toHaveLength(0); // Setup compiles, it does not acquire.
  const staged: Awaited<ReturnType<typeof setup.definition.namespace.port.stage>>[] = [];
  let fail = true;
  const definition = defineManagedAgentComposition({
    ...setup.definition,
    namespace: {
      port: {
        ...setup.definition.namespace.port,
        stage: async (id) => {
          const namespace = await setup.definition.namespace.port.stage(id);
          // The generic authority factory is synchronous and already usable at stage delivery.
          expect(setup.definition.authority.createPorts(namespace)).not.toBeInstanceOf(Promise);
          staged.push(namespace);
          return namespace;
        },
      },
    },
    authority: {
      createPorts: (namespace) => {
        const ports = setup.definition.authority.createPorts(namespace);
        return {
          identityCatalog: ports.identityCatalog,
          config: {
            read: (id) => ports.config.read(id),
            write: (input) =>
              fail ? Promise.reject(new Error('Config write failed')) : ports.config.write(input),
          },
        };
      },
    },
  });
  const agents = createAgentManagementService(definition);
  const input = { identity: { id: 'retry' }, config: resourceProfileConfig() };
  await expect(agents.create(input)).rejects.toBeDefined();
  expect(allocations[0]?.release).toHaveBeenCalledOnce();
  fail = false;
  const created = await agents.create(input);
  expect(created.authority.config.revision).toBe(1);
  expect(created.authority.identity.revision).toBe(1);
  expect(allocations).toHaveLength(2);
  expect(allocations[1]?.id).not.toBe(allocations[0]?.id);
  const old = staged[0];
  const current = staged[1];
  if (old === undefined || current === undefined) throw new Error('Missing allocation');
  expect(old.handle.token).not.toBe(current.handle.token);
  const published = await setup.definition.namespace.port.resolve(
    created.authority.identity.identity.id
  );
  expect(published?.handle).toBe(current.handle);
  if (published === undefined) throw new Error('Missing publication');
  expect(setup.definition.authority.createPorts(published)).toBe(
    setup.definition.authority.createPorts(current)
  );
  for (const operation of [
    () => setup.definition.authority.createPorts(old),
    () => setup.definition.namespace.port.publish(old),
    () => setup.definition.namespace.port.abort(old),
  ])
    await expect(Promise.resolve().then<unknown>(operation)).rejects.toMatchObject({
      code: 'STANDALONE_AGENT_STORAGE_INVALID',
    });
  await setup.close();
  expect(allocations[1]?.release).toHaveBeenCalledOnce();
  expect(allocations[0]?.release).toHaveBeenCalledOnce();
});

it.each(['create', 'validation'] as const)(
  'aborts and permits same-ID retry after stage %s fails cleanly before returning a handle',
  async (phase) => {
    let fail = true;
    const ids: string[] = [];
    const release = vi.fn();
    const setup = createStandaloneMemorySetup({
      readEnvironmentVariable: () => undefined,
      acquireAuthority: ({ allocationId }) => {
        ids.push(allocationId);
        if (fail && phase === 'create') throw new Error('Clean initialization failure');
        return {
          value: fail
            ? {
                identityCatalog: new MemoryAgentIdentityCatalogAdapter(),
                get config(): ManagedAgentAuthorityPorts['config'] {
                  throw new Error('Invalid authority');
                },
              }
            : authority(),
          release,
        };
      },
    });
    const agents = createAgentManagementService(setup.definition);
    const input = { identity: { id: 'retry' }, config: resourceProfileConfig() };
    await expect(agents.create(input)).rejects.toBeDefined();
    expect(await setup.definition.namespace.port.list()).toEqual([]);
    fail = false;
    const created = await agents.create(input);
    expect(created.authority.config.revision).toBe(1);
    expect(ids[0]).not.toBe(ids[1]);
    await setup.close();
    expect(release).toHaveBeenCalledTimes(phase === 'validation' ? 2 : 1);
  }
);

it.each(['unwind', 'post-validation'] as const)(
  'retains a never-delivered failed stage after %s cleanup failure and cleans independent allocations',
  async (phase) => {
    const primary = new Error('Authority preparation failed');
    const cleanup = new Error('Authority resource still live');
    const brokenRelease = vi.fn(() => {
      throw cleanup;
    });
    const healthyRelease = vi.fn();
    const setup = createStandaloneMemorySetup({
      readEnvironmentVariable: () => undefined,
      acquireAuthority: ({ agentId }) => {
        if (agentId !== 'broken') return { value: authority(), release: healthyRelease };
        if (phase === 'unwind') throw new ResourceCleanupError({ primary, failures: [cleanup] });
        return {
          value: {
            identityCatalog: new MemoryAgentIdentityCatalogAdapter(),
            get config(): ManagedAgentAuthorityPorts['config'] {
              throw primary;
            },
          },
          release: brokenRelease,
        };
      },
    });
    let delivered = false;
    await expect(
      setup.definition.namespace.port.stage(parseAgentId('broken')).then((handle) => {
        delivered = true;
        return handle;
      })
    ).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    expect(delivered).toBe(false);
    expect(await setup.definition.namespace.port.list()).toEqual([]);
    await expect(
      setup.definition.namespace.port.stage(parseAgentId('broken'))
    ).rejects.toMatchObject({
      code: 'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
    });
    const healthy = await setup.definition.namespace.port.stage(parseAgentId('healthy'));
    if (phase === 'unwind') await setup.definition.namespace.port.publish(healthy);
    const closing = setup.close();
    await expect(closing).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
    expect(healthyRelease).toHaveBeenCalledOnce();
    expect(brokenRelease).toHaveBeenCalledTimes(phase === 'post-validation' ? 1 : 0);
    expect(setup.close({ mode: 'abort' })).toBe(closing);
  }
);

it('joins shutdown during stage, cancels real acquisition and releases a late result without returning a handle', async () => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<AbortSignal>();
  const release = vi.fn();
  const setup = createStandaloneMemorySetup({
    readEnvironmentVariable: () => undefined,
    acquireAuthority: async ({ signal }) => {
      started.resolve(signal);
      await gate.promise;
      return { value: authority(), release };
    },
  });
  const staging = setup.definition.namespace.port.stage(parseAgentId('staging'));
  const rejected = expect(staging).rejects.toMatchObject({ code: 'RESOURCE_OPERATION_ABORTED' });
  const signal = await started.promise;
  let closed = false;
  const closing = setup.close({ mode: 'abort' }).then(() => {
    closed = true;
  });
  expect(signal.aborted).toBe(true);
  await Promise.resolve();
  expect(closed).toBe(false);
  gate.resolve();
  await rejected;
  await closing;
  expect(release).toHaveBeenCalledOnce();
});

it('reserves an ID while stage is pending, without blocking or sharing independent allocations', async () => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const release = vi.fn();
  const setup = createStandaloneMemorySetup({
    readEnvironmentVariable: () => undefined,
    acquireAuthority: async ({ agentId }) => {
      if (agentId === 'pending') {
        started.resolve();
        await gate.promise;
      }
      return { value: authority(), release };
    },
  });
  const staging = setup.definition.namespace.port.stage(parseAgentId('pending'));
  await started.promise;
  await expect(
    setup.definition.namespace.port.stage(parseAgentId('pending'))
  ).rejects.toMatchObject({
    code: 'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
  });
  const other = await setup.definition.namespace.port.stage(parseAgentId('other'));
  await setup.definition.namespace.port.abort(other);
  gate.resolve();
  const staged = await staging;
  await setup.definition.namespace.port.publish(staged);
  await setup.close();
  expect(release).toHaveBeenCalledTimes(2);
});

it('honors business cancellation before publication, then permits a fresh same-ID create', async () => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const release = vi.fn();
  const setup = createStandaloneMemorySetup({
    readEnvironmentVariable: () => undefined,
    acquireAuthority: async () => {
      started.resolve();
      await gate.promise;
      return { value: authority(), release };
    },
  });
  const agents = createAgentManagementService(setup.definition);
  const controller = new AbortController();
  const input = { identity: { id: 'cancelled-stage' }, config: resourceProfileConfig() };
  const creating = agents.create(input, { signal: controller.signal });
  const rejected = expect(creating).rejects.toMatchObject({
    code: 'MANAGED_AGENT_OPERATION_CANCELLED',
  });
  await started.promise;
  controller.abort();
  gate.resolve();
  await rejected;
  expect(release).toHaveBeenCalledOnce();
  expect(await agents.list()).toEqual([]);
  const created = await agents.create(input);
  expect(created.authority.identity.revision).toBe(1);
  expect(created.authority.config.revision).toBe(1);
  await setup.close();
  expect(release).toHaveBeenCalledTimes(2);
});

it('quarantines a real staged abort cleanup failure, retaining it for shutdown while cleaning healthy allocations', async () => {
  const brokenRelease = vi.fn(() => {
    throw new Error('Allocation not released');
  });
  const healthyRelease = vi.fn();
  const setup = createStandaloneMemorySetup({
    readEnvironmentVariable: () => undefined,
    acquireAuthority: ({ agentId }) => ({
      value: authority(),
      release: agentId === 'broken' ? brokenRelease : healthyRelease,
    }),
  });
  const staged = await setup.definition.namespace.port.stage(parseAgentId('broken'));
  await expect(setup.definition.namespace.port.abort(staged)).rejects.toMatchObject({
    code: 'RESOURCE_CLEANUP_FAILED',
  });
  await expect(setup.definition.namespace.port.stage(parseAgentId('broken'))).rejects.toMatchObject(
    {
      code: 'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
    }
  );
  await expect(
    Promise.resolve().then(() => setup.definition.namespace.port.publish(staged))
  ).rejects.toMatchObject({ code: 'STANDALONE_AGENT_STORAGE_INVALID' });
  const healthy = await setup.definition.namespace.port.stage(parseAgentId('healthy'));
  await setup.definition.namespace.port.publish(healthy);
  const closing = setup.close();
  await expect(closing).rejects.toMatchObject({ code: 'RESOURCE_CLEANUP_FAILED' });
  expect(setup.close()).toBe(closing);
  expect(brokenRelease).toHaveBeenCalledOnce();
  expect(healthyRelease).toHaveBeenCalledOnce();
});
