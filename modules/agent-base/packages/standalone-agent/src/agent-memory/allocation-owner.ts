import type {
  ManagedAgentNamespace,
  ManagedAgentNamespaceReference,
} from '@print-an-agent/base-composition';
import {
  createResourceScope,
  ResourceCleanupError,
  type ResourceScope,
} from '@print-an-agent/base-composition/resource-registry';
import { AgentBaseStandaloneError } from '../errors.js';
import { setupCloseFailure, type StandaloneSetupCloseOptions } from '../setup/index.js';
import { memoryManagementRecipe } from './provisioning/recipe.js';
import type { RuntimeMemoryLifetime } from './runtime/lifetime.js';
import type { MemoryAllocationOwner, MemoryProfileAllocation } from './types/allocation.js';
import type { StandaloneMemoryManagementOptions } from './types/options.js';
import type { MemoryManagementRecipe } from './types/provisioning.js';
import type { MemorySetupSource } from './types/setup.js';
import type { AgentMemoryStorageBinding } from './types/storage.js';

interface OwnedAllocation {
  readonly scope: ResourceScope;
  readonly recipe: MemoryManagementRecipe;
}

/** Owns one Scope per published allocation and joins cleanup with the original Profile. */
export function createMemoryAllocationOwner<N>(
  source: MemorySetupSource<N>,
  options: StandaloneMemoryManagementOptions,
  storage: (namespace: ManagedAgentNamespaceReference<N>) => AgentMemoryStorageBinding,
  runtimeLifetime: RuntimeMemoryLifetime
): MemoryAllocationOwner<N> {
  let open = true;
  let closing: Promise<void> | undefined;
  const owned = new Map<string | symbol, OwnedAllocation>();
  const assertOpen = (): void => {
    if (!open) throw new AgentBaseStandaloneError('Standalone Memory management setup is closed.');
  };
  const resolve = async (namespace: ManagedAgentNamespace<N>): Promise<MemoryProfileAllocation> => {
    assertOpen();
    const current = await source.definition.namespace.port.resolve(namespace.agentId);
    assertOpen();
    const binding = storage(namespace);
    if (
      namespace.phase !== 'published' ||
      current === undefined ||
      storage(current).key !== binding.key
    )
      throw new AgentBaseStandaloneError(
        'Memory namespace does not own the current published allocation.'
      );
    let value = owned.get(binding.key);
    if (value === undefined) {
      const recipe = memoryManagementRecipe(options, namespace.agentId, binding);
      value = { recipe, scope: createResourceScope(recipe.blueprint) };
      owned.set(binding.key, value);
    }
    return { recipe: value.recipe, registry: value.scope.registry };
  };

  return {
    assertOpen,
    resolve,
    close: (closeOptions: StandaloneSetupCloseOptions = {}) => {
      const failure = setupCloseFailure(closeOptions);
      if (failure !== undefined) return Promise.reject(failure);
      open = false;
      try {
        runtimeLifetime.prepareClose(closeOptions);
      } catch (cause) {
        return Promise.reject(
          cause instanceof Error ? cause : new Error('Runtime Memory close failed.', { cause })
        );
      }
      const joined = Promise.allSettled([
        ...[...owned.values()].map(({ scope }) => scope.close(closeOptions)),
        source.close(closeOptions),
      ]);
      closing ??= joined.then((results) => {
        const failures = results.flatMap((r) =>
          r.status === 'rejected' ? [r.reason as unknown] : []
        );
        if (failures.length) throw new ResourceCleanupError({ failures });
        owned.clear();
      });
      // Every repeated close is joined, including drain -> abort escalation.
      void joined.catch(() => undefined);
      return closing;
    },
  };
}
