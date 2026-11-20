import { randomUUID } from 'node:crypto';
import {
  ManagedAgentNamespaceError,
  type ManagedAgentAuthorityPortFactory,
  type ManagedAgentAuthorityPorts,
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  type ManagedAgentNamespaceReference,
  type ManagedAgentRuntimePortFactory,
  type SessionManagementPortFactory,
  type SessionManagementPorts,
  type SessionNavigationPortFactory,
  type SessionNavigationPorts,
  type StagedManagedAgentNamespace,
} from '@print-an-agent/base-composition';
import { parseAgentId, type AgentId } from '@print-an-agent/base-identity-config/identity';
import {
  createResourceScope,
  ResourceCleanupError,
  type ResourceCloseOptions,
  type ResourceScope,
} from '@print-an-agent/base-composition/resource-registry';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneRuntimePorts } from '../../runtime/materialize-standalone-agent.js';
import type { StandaloneAgentConfig, CreateStandaloneMemoryProfileOptions } from '../../types.js';
import { memoryResourceBlueprint } from './blueprint.js';
import { setupCloseFailure } from '../../profiles/setup.js';

/** Opaque allocation identity, not an AgentId or storage path. */
export interface MemoryAgentResourceNamespace {
  readonly token: symbol;
}

interface MemoryAllocation {
  namespace:
    | StagedManagedAgentNamespace<MemoryAgentResourceNamespace>
    | ManagedAgentNamespace<MemoryAgentResourceNamespace>;
  readonly allocationId: string;
  readonly scope: ResourceScope;
  accepting: boolean;
  /** A prepared dependency reference for the synchronous factory, not another owner/cache. */
  prepared?: Readonly<{ authority: ManagedAgentAuthorityPorts }>;
}

interface MemoryStandaloneResourceProvisioner {
  readonly namespacePort: ManagedAgentNamespacePort<MemoryAgentResourceNamespace>;
  readonly createAuthorityPorts: ManagedAgentAuthorityPortFactory<MemoryAgentResourceNamespace>;
  readonly createRuntimePorts: ManagedAgentRuntimePortFactory<
    StandaloneAgentConfig,
    MemoryAgentResourceNamespace,
    StandaloneRuntimePorts
  >;
  readonly createSessionManagementPorts: SessionManagementPortFactory<
    MemoryAgentResourceNamespace,
    SessionManagementPorts
  >;
  readonly createSessionNavigationPorts: SessionNavigationPortFactory<
    MemoryAgentResourceNamespace,
    SessionNavigationPorts
  >;
  readonly close: (options?: ResourceCloseOptions) => Promise<void>;
}

function invalidNamespace(): never {
  throw new AgentBaseStandaloneError('Memory namespace does not own an available allocation.', {
    code: 'STANDALONE_AGENT_STORAGE_INVALID',
  });
}

/** Profile owner, not Core parent/child Scopes. Keeps failed allocations until cleanup is confirmed. */
class MemoryProfileOwner {
  readonly #allocations = new Map<AgentId, MemoryAllocation>();
  readonly #owned = new Set<MemoryAllocation>();
  readonly #recipe: ReturnType<typeof memoryResourceBlueprint>;
  #open = true;
  #closing?: Promise<void>;

  constructor(
    options: Pick<
      CreateStandaloneMemoryProfileOptions,
      'clock' | 'acquireAuthority' | 'acquireSessionPersistence'
    >
  ) {
    this.#recipe = memoryResourceBlueprint(options);
  }

  readonly namespacePort: ManagedAgentNamespacePort<MemoryAgentResourceNamespace> = Object.freeze({
    stage: (agentId: AgentId) => this.#stage(agentId),
    publish: (staged: StagedManagedAgentNamespace<MemoryAgentResourceNamespace>) => {
      const allocation = this.#allocation(staged);
      if (staged.phase !== 'staged' || allocation.namespace.phase !== 'staged') invalidNamespace();
      const published = Object.freeze({
        agentId: allocation.namespace.agentId,
        handle: allocation.namespace.handle,
        phase: 'published' as const,
      });
      allocation.namespace = published;
      return Promise.resolve(published);
    },
    abort: async (staged: StagedManagedAgentNamespace<MemoryAgentResourceNamespace>) => {
      const allocation = this.#allocation(staged);
      if (staged.phase !== 'staged' || allocation.namespace.phase !== 'staged') invalidNamespace();
      allocation.accepting = false;
      await allocation.scope.close({ mode: 'abort' });
      this.#forget(allocation);
    },
    resolve: (agentId: AgentId) => {
      this.#assertOpen();
      const namespace = this.#allocations.get(parseAgentId(agentId))?.namespace;
      return Promise.resolve(namespace?.phase === 'published' ? namespace : undefined);
    },
    list: () => {
      this.#assertOpen();
      return Promise.resolve(
        Object.freeze(
          [...this.#allocations.values()]
            .map(({ namespace }) => namespace)
            .filter(
              (namespace): namespace is ManagedAgentNamespace<MemoryAgentResourceNamespace> =>
                namespace.phase === 'published'
            )
            .sort((left, right) => left.agentId.localeCompare(right.agentId))
        )
      );
    },
  });

  readonly createAuthorityPorts: MemoryStandaloneResourceProvisioner['createAuthorityPorts'] = (
    namespace
  ) => {
    const allocation = this.#allocation(namespace);
    if (allocation.prepared === undefined) invalidNamespace();
    // A Session-resource fence does not hide independently committed authority. The Profile
    // still validates namespace admission; setup close/quarantined allocations cannot use it.
    return allocation.prepared.authority;
  };

  readonly createRuntimePorts: MemoryStandaloneResourceProvisioner['createRuntimePorts'] = async ({
    namespace,
  }) => {
    const { session, requestJournal } = await this.#persistence(namespace);
    return Object.freeze({ session, requestJournal });
  };

  readonly createSessionManagementPorts: MemoryStandaloneResourceProvisioner['createSessionManagementPorts'] =
    async (namespace) => {
      const { session, maintenance } = await this.#persistence(namespace);
      return Object.freeze({ session, maintenance });
    };

  readonly createSessionNavigationPorts: MemoryStandaloneResourceProvisioner['createSessionNavigationPorts'] =
    async (namespace) => {
      const { session } = await this.#persistence(namespace);
      return Object.freeze({ session });
    };

  async #stage(input: AgentId): Promise<StagedManagedAgentNamespace<MemoryAgentResourceNamespace>> {
    this.#assertOpen();
    const agentId = parseAgentId(input);
    if (this.#allocations.has(agentId)) {
      throw new ManagedAgentNamespaceError(
        'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
        'Memory Agent namespace is already reserved or published.'
      );
    }
    const namespace = Object.freeze({
      agentId,
      handle: Object.freeze({ token: Symbol() }),
      phase: 'staged' as const,
      resumed: false,
    });
    const allocation: MemoryAllocation = {
      namespace,
      allocationId: randomUUID(),
      scope: createResourceScope(this.#recipe.blueprint),
      accepting: true,
    };
    // Scope construction is zero I/O. Ownership is registered before any resource factory runs.
    this.#allocations.set(agentId, allocation);
    this.#owned.add(allocation);
    try {
      const authority = await allocation.scope.registry.resolve(
        this.#recipe.authority.request({
          agentId,
          allocationId: allocation.allocationId,
        })
      );
      this.#assertOpen();
      allocation.prepared = Object.freeze({ authority });
      return namespace;
    } catch (primary) {
      allocation.accepting = false;
      // No stage handle has escaped: Profile, not generic create's abort, owns this unwind.
      try {
        await allocation.scope.close({ mode: 'abort' });
      } catch (cleanup) {
        throw new ResourceCleanupError({ primary, failures: [cleanup] });
      }
      this.#forget(allocation);
      throw primary;
    }
  }

  #forget(allocation: MemoryAllocation): void {
    if (this.#allocations.get(allocation.namespace.agentId) === allocation)
      this.#allocations.delete(allocation.namespace.agentId);
    this.#owned.delete(allocation);
    delete allocation.prepared;
  }

  #allocation(
    namespace: ManagedAgentNamespaceReference<MemoryAgentResourceNamespace>
  ): MemoryAllocation {
    this.#assertOpen();
    const allocation = this.#allocations.get(parseAgentId(namespace.agentId));
    if (
      allocation === undefined ||
      !allocation.accepting ||
      allocation.namespace.handle.token !== namespace.handle.token
    )
      invalidNamespace();
    return allocation;
  }

  #persistence(namespace: ManagedAgentNamespace<MemoryAgentResourceNamespace>) {
    const allocation = this.#allocation(namespace);
    if (namespace.phase !== 'published' || allocation.namespace.phase !== 'published')
      invalidNamespace();
    return allocation.scope.registry.resolve(
      this.#recipe.persistence.request({
        agentId: namespace.agentId,
        allocationId: allocation.allocationId,
      })
    );
  }

  #assertOpen(): void {
    if (!this.#open)
      throw new AgentBaseStandaloneError('Memory Profile setup is closed.', {
        code: 'STANDALONE_AGENT_STORAGE_INVALID',
      });
  }

  readonly close = (options: ResourceCloseOptions = {}): Promise<void> => {
    const failure = setupCloseFailure(options);
    if (failure !== undefined) return Promise.reject(failure);
    this.#open = false;
    // Forward repeated close for drain -> abort escalation; observe every join.
    const joined = Promise.allSettled([...this.#owned].map(({ scope }) => scope.close(options)));
    this.#closing ??= joined.then((results) => {
      const failures: unknown[] = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason as unknown] : []
      );
      if (failures.length !== 0) throw new ResourceCleanupError({ failures });
      this.#owned.clear();
      this.#allocations.clear();
    });
    return this.#closing;
  };
}

export function createMemoryStandaloneResourceProvisioner(
  options: Pick<
    CreateStandaloneMemoryProfileOptions,
    'clock' | 'acquireAuthority' | 'acquireSessionPersistence'
  >
): MemoryStandaloneResourceProvisioner {
  const owner = new MemoryProfileOwner(options);
  return Object.freeze({
    close: owner.close,
    namespacePort: owner.namespacePort,
    createAuthorityPorts: owner.createAuthorityPorts,
    createRuntimePorts: owner.createRuntimePorts,
    createSessionManagementPorts: owner.createSessionManagementPorts,
    createSessionNavigationPorts: owner.createSessionNavigationPorts,
  });
}
