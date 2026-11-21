import {
  CONTEXT_MEMORY_TOOL_NAMES,
  defineManagedAgentComposition,
  recoverSessionWithContextMemory,
  validateMemoryIdentifier,
  type ContextMemoryManagementCapability,
  type ManagedAgentNamespace,
  type ManagedAgentNamespaceReference,
  type RetrievalMemoryManagementCapability,
  type RuntimeMemorySessionPort,
  type SessionContextMemoryCoordinator,
  type SessionContextMemoryService,
  type SessionManagedAgentCompositionDefinition,
  type SessionManagementPorts,
  type SessionNavigationCapability,
  type SessionNavigationPorts,
} from '@print-an-agent/base-composition';
import {
  createResourceScope,
  ResourceCleanupError,
  type ResourceScope,
} from '@print-an-agent/base-composition/resource-registry';
import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type { StandaloneAgentConfig } from '../../configuration/index.js';
import { AgentBaseStandaloneError } from '../../errors.js';
import { setupCloseFailure, type StandaloneSetupCloseOptions } from '../../profiles/setup.js';
import type { StandaloneRawAgent, StandaloneRuntimePorts } from '../../runtime/index.js';
import { contextMemoryProvisioning } from './context.js';
import type { AgentMemoryStorageBinding, StandaloneMemoryManagementOptions } from './contracts.js';
import { memoryManagementRecipe, type MemoryManagementRecipe } from './recipe.js';
import { retrievalMemoryProvisioning } from './retrieval.js';
import { RuntimeMemoryLifetime } from './runtime-lifetime.js';
import { runtimeMemoryProvisioning, runtimeMemorySession } from './runtime.js';

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

export interface StandaloneSessionContextMemory {
  resolve(agentId: string): Promise<SessionContextMemoryCoordinator>;
  /** Product Profile supplies its declared Session authority; no adapters are fetched from another Service. */
  bind(
    agentId: string,
    session: RuntimeMemorySessionPort
  ): Promise<SessionContextMemoryCoordinator>;
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
  readonly sessionContextMemory?: StandaloneSessionContextMemory;
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
            ...(input.context.runtime === undefined
              ? {}
              : {
                  runtime: Object.freeze({
                    ...input.context.runtime,
                    ...(input.context.runtime.toolAllowList === undefined
                      ? {}
                      : { toolAllowList: Object.freeze([...input.context.runtime.toolAllowList]) }),
                    ...(input.context.runtime.workflows === undefined
                      ? {}
                      : { workflows: Object.freeze({ ...input.context.runtime.workflows }) }),
                  }),
                }),
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
  const runtimeEnabled = (agentId: string) =>
    options.context?.runtime !== undefined && (options.context.runtime.enabled?.(agentId) ?? true);
  const runtimeLifetime = new RuntimeMemoryLifetime();
  const runtimeMemory = runtimeMemoryProvisioning(options, allocation, runtimeLifetime);
  const coordinator = (service: SessionContextMemoryService): SessionContextMemoryCoordinator => ({
    authorityId: service.authorityId,
    open: (target, signal) => runtimeLifetime.track(service).open(target, signal),
    inspect: service.inspect.bind(service),
    apply: service.apply.bind(service),
    initialize: service.initialize.bind(service),
    recover: service.recover.bind(service),
    readCheckpoint: service.readCheckpoint.bind(service),
    acknowledgeCleanup: service.acknowledgeCleanup.bind(service),
    navigationPort: service.navigationPort.bind(service),
  });
  const memoryNamespace = async (agentId: string) => {
    if (!runtimeEnabled(agentId))
      throw new AgentBaseStandaloneError('Runtime Context Memory is disabled for this Agent.');
    const namespace = await source.definition.namespace.port.resolve(parseAgentId(agentId));
    guard();
    if (namespace === undefined) throw new AgentBaseStandaloneError('Agent was not found.');
    return namespace;
  };
  const runtime: BaseDefinition<N>['runtime'] = {
    createPorts: async (request) => {
      const ports = await source.definition.runtime.createPorts(request);
      return !runtimeEnabled(request.namespace.agentId)
        ? ports
        : {
            ...ports,
            contextMemory: runtimeLifetime.track(
              await runtimeMemory(request.namespace, ports.session)
            ),
            contextMemoryToolAllowList:
              options.context?.runtime?.toolAllowList ??
              (options.context?.runtime?.writable === true
                ? CONTEXT_MEMORY_TOOL_NAMES
                : ['read_context_memory']),
          };
    },
    materialize: (request) => source.definition.runtime.materialize(request),
  };
  const sessionNavigation: BaseDefinition<N>['sessionNavigation'] = {
    createPorts: async (namespace) => {
      const ports = await source.definition.sessionNavigation.createPorts(namespace);
      if (!runtimeEnabled(namespace.agentId)) return ports;
      runtimeMemorySession(ports.session);
      const service = await runtimeMemory(namespace, ports.session);
      return { session: service.navigationPort(ports.session) };
    },
  };
  const sessionManagement: BaseDefinition<N>['sessionManagement'] = {
    createPorts: async (namespace) => {
      const ports = await source.definition.sessionManagement.createPorts(namespace);
      if (!runtimeEnabled(namespace.agentId)) return ports;
      return {
        ...ports,
        maintenance: {
          purgeSessionPersistence: (request) => ports.maintenance.purgeSessionPersistence(request),
          recoverSessionPersistence: (request, call) => {
            runtimeMemorySession(ports.session);
            return recoverSessionWithContextMemory(
              {
                session: ports.session,
                maintenance: ports.maintenance,
                resolveMemory: () => runtimeMemory(namespace, ports.session),
              },
              request,
              call
            );
          },
        },
      };
    },
  };
  const definition = defineManagedAgentComposition({
    ...source.definition,
    runtime,
    sessionNavigation,
    sessionManagement,
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
    ...(options.context?.runtime === undefined
      ? {}
      : {
          sessionContextMemory: {
            resolve: async (agentId: string) => {
              const namespace = await memoryNamespace(agentId);
              const ports = await source.definition.sessionNavigation.createPorts(namespace);
              return coordinator(await runtimeMemory(namespace, ports.session));
            },
            bind: async (agentId: string, session: RuntimeMemorySessionPort) =>
              coordinator(await runtimeMemory(await memoryNamespace(agentId), session)),
          },
        }),
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
  });
}
