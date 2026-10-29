import {
  defineManagedAgentComposition,
  validateMemoryIdentifier,
  type ContextMemoryManagementCapability,
  type RetrievalMemoryManagementCapability,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
  type ManagedAgentNamespaceReference,
  type ManagedAgentNamespace,
} from '@ta-agent/base-composition';
import {
  createResourceScope,
  ResourceCleanupError,
  type ResourceScope,
} from '@ta-agent/base-composition/resource-registry';
import type { StandaloneAgentConfig, StandaloneRawAgent } from '../../types.js';
import type { StandaloneRuntimePorts } from '../../runtime/materialize-standalone-agent.js';
import { setupCloseFailure, type StandaloneSetupCloseOptions } from '../../profiles/setup.js';
import { AgentBaseStandaloneError } from '../../errors.js';
import { memoryManagementRecipe, type MemoryManagementRecipe } from './recipe.js';
import { contextMemoryProvisioning } from './context.js';
import { retrievalMemoryProvisioning } from './retrieval.js';
import type { AgentMemoryStorageBinding, StandaloneMemoryManagementOptions } from './contracts.js';

type BaseDefinition<N> = SessionManagedAgentCompositionDefinition<
  StandaloneAgentConfig,
  N,
  StandaloneRuntimePorts,
  StandaloneRawAgent,
  SessionManagementPorts
> &
  SessionNavigationCapability<N, SessionNavigationPorts>;
export type MemoryManagedStandaloneDefinition<N> = BaseDefinition<N> &
  Partial<ContextMemoryManagementCapability<N> & RetrievalMemoryManagementCapability<N>>;
interface OwnedAllocation {
  readonly scope: ResourceScope;
  readonly recipe: MemoryManagementRecipe;
}

/** Adds only optional product resources; the original Profile remains authority/runtime owner. */
export function withStandaloneMemoryManagement<N>(
  source: {
    readonly definition: BaseDefinition<N>;
    close(options?: StandaloneSetupCloseOptions): Promise<void>;
  },
  input: StandaloneMemoryManagementOptions | undefined,
  storage: (namespace: ManagedAgentNamespaceReference<N>) => AgentMemoryStorageBinding
): {
  readonly definition: MemoryManagedStandaloneDefinition<N>;
  close(options?: StandaloneSetupCloseOptions): Promise<void>;
} {
  if (input === undefined) return source;
  validateMemoryIdentifier(input.storageNamespaceId);
  const options: StandaloneMemoryManagementOptions = Object.freeze({
    ...input,
    ...(input.context === undefined
      ? {}
      : {
          context: Object.freeze({
            ...input.context,
            ...(input.context.workflows === undefined
              ? {}
              : { workflows: Object.freeze({ ...input.context.workflows }) }),
            ...(input.context.defaults === undefined
              ? {}
              : { defaults: structuredClone(input.context.defaults) }),
          }),
        }),
    ...(input.retrieval === undefined
      ? {}
      : {
          retrieval: Object.freeze({
            ...input.retrieval,
            ...(input.retrieval.workflows === undefined
              ? {}
              : { workflows: Object.freeze({ ...input.retrieval.workflows }) }),
            ...(input.retrieval.policy === undefined
              ? {}
              : { policy: Object.freeze({ ...input.retrieval.policy }) }),
          }),
        }),
  });
  let open = true;
  let closing: Promise<void> | undefined;
  const owned = new Map<string | symbol, OwnedAllocation>();
  const guard = () => {
    if (!open) throw new AgentBaseStandaloneError('Standalone Memory management setup is closed.');
  };
  const allocation = async (namespace: ManagedAgentNamespace<N>) => {
    guard();
    const current = await source.definition.namespace.port.resolve(namespace.agentId);
    guard();
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
  const port = source.definition.namespace.port;
  const definition = defineManagedAgentComposition({
    ...source.definition,
    namespace: {
      port: {
        stage: (id) => {
          guard();
          return port.stage(id);
        },
        publish: (namespace) => {
          guard();
          return port.publish(namespace);
        },
        resolve: (id) => {
          guard();
          return port.resolve(id);
        },
        list: () => {
          guard();
          return port.list();
        },
        abort: async (namespace) => {
          guard();
          // Memory resolution requires published authority. A staged allocation therefore has
          // no Memory acquisitions; a stale abort must never close a published allocation's Scope.
          await port.abort(namespace);
        },
      },
    },
    ...(options.context === undefined
      ? {}
      : { contextMemoryManagement: contextMemoryProvisioning(options, allocation) }),
    ...(options.retrieval === undefined
      ? {}
      : { retrievalMemoryManagement: retrievalMemoryProvisioning(options, allocation) }),
  });
  return Object.freeze({
    definition,
    close: (closeOptions: StandaloneSetupCloseOptions = {}) => {
      const failure = setupCloseFailure(closeOptions);
      if (failure !== undefined) return Promise.reject(failure);
      open = false;
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
  });
}
