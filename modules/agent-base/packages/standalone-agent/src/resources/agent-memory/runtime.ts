import {
  createSessionContextMemory,
  type ContextMemoryWorkflows,
  type SessionContextMemoryService,
} from '@print-an-agent/base-composition';
import {
  supportsSessionMemoryNavigation,
  supportsSessionExecution,
} from '@print-an-agent/base-session';
import {
  createVersionedContextMemoryBundle,
  createVersionedContextMemoryResources,
  MemoryMeter,
  supportsMemoryHistory,
} from '@print-an-agent/context-memory';
import type { ManagedAgentNamespace } from '@print-an-agent/base-composition';
import type { RuntimeMemorySessionPort } from '@print-an-agent/base-composition';
import type { StandaloneMemoryManagementOptions } from './contracts.js';
import type { MemoryAllocationResolver } from './context.js';
import { DEFAULT_MEMORY_MEASUREMENT_REF } from './recipe.js';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { RuntimeMemoryLifetime } from './runtime-lifetime.js';

export function runtimeMemorySession(value: object): asserts value is RuntimeMemorySessionPort {
  if (
    !supportsSessionMemoryNavigation(value) ||
    !supportsSessionExecution(value) ||
    !('inspect' in value) ||
    typeof value.inspect !== 'function'
  )
    throw new AgentBaseStandaloneError(
      'Runtime Context Memory requires version-coordinated Session capabilities.'
    );
}

/** Profile resource resolution, not a second runtime. Services borrow the same allocation's root. */
export function runtimeMemoryProvisioning<N>(
  options: StandaloneMemoryManagementOptions,
  allocation: MemoryAllocationResolver<N>,
  lifetime: RuntimeMemoryLifetime
) {
  return async (
    namespace: ManagedAgentNamespace<N>,
    session: object
  ): Promise<SessionContextMemoryService> => {
    runtimeMemorySession(session);
    const installed = options.context?.runtime;
    if (installed === undefined)
      throw new AgentBaseStandaloneError('Runtime Context Memory is not installed.');
    const { registry, recipe } = await allocation(namespace);
    const store = await registry.resolve(recipe.store.request('authority'));
    if (!supportsMemoryHistory(store))
      throw new AgentBaseStandaloneError(
        'Runtime Context Memory requires the formal history store capability.'
      );
    const bundle = createVersionedContextMemoryBundle({
      resources: createVersionedContextMemoryResources({
        store,
        meter: new MemoryMeter({
          resolveCounter: (ref, signal) =>
            registry.resolve(recipe.counter.request(ref), { signal }),
        }),
        defaults: { measurementRef: DEFAULT_MEMORY_MEASUREMENT_REF, ...options.context?.defaults },
      }),
      workflows: { ...options.context?.workflows, ...installed.workflows },
    });
    // Revalidate the published allocation for every use, including a cached raw Agent or Service.
    const guard = async () => {
      await allocation(namespace);
    };
    const workflows: ContextMemoryWorkflows = {
      inspect: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.inspect.run({ ...call, signal })
          );
        },
      },
      create: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.create.run({ ...call, signal })
          );
        },
      },
      apply: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.apply.run({ ...call, signal })
          );
        },
      },
      getReceipt: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.getReceipt.run({ ...call, signal })
          );
        },
      },
      inspectVersion: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.inspectVersion.run({ ...call, signal })
          );
        },
      },
      readVersionContext: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.readVersionContext.run({ ...call, signal })
          );
        },
      },
      fork: {
        run: async (call) => {
          await guard();
          return lifetime.invoke(call.signal, (signal) =>
            bundle.workflows.fork.run({ ...call, signal })
          );
        },
      },
    };
    return createSessionContextMemory({
      agentId: namespace.agentId,
      authorityId: JSON.stringify([
        'standalone-session-memory',
        options.storageNamespaceId,
        namespace.agentId,
      ]),
      session,
      memory: workflows,
      writable: installed.writable === true,
      ...(installed.createTools === undefined ? {} : { createTools: installed.createTools }),
    });
  };
}
