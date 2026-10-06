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
} from '@ta-agent/base-composition';
import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
  createMemorySessionPersistence,
  type CoordinatedSessionPersistence,
} from '@ta-agent/base-local-adapters';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneRuntimePorts } from '../../runtime/materialize-standalone-agent.js';
import type { StandaloneAgentConfig } from '../../types.js';

/** An allocation identity local to one Memory profile setup, not a storage path. */
export interface MemoryAgentResourceNamespace {
  readonly token: symbol;
}

interface MemoryAllocation {
  namespace:
    | StagedManagedAgentNamespace<MemoryAgentResourceNamespace>
    | ManagedAgentNamespace<MemoryAgentResourceNamespace>;
  authority?: ManagedAgentAuthorityPorts;
  persistence?: CoordinatedSessionPersistence;
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
}

function invalidNamespace(): never {
  throw new AgentBaseStandaloneError('Memory namespace does not own the requested allocation.', {
    code: 'STANDALONE_AGENT_STORAGE_INVALID',
  });
}

/** Owns ephemeral authority, not an evictable cache or a registry of arbitrary resources. */
class MemoryResourceScope {
  readonly #allocations = new Map<AgentId, MemoryAllocation>();
  readonly #options: Readonly<{ clock?: () => number }>;

  constructor(options: Readonly<{ clock?: () => number }>) {
    this.#options = Object.freeze({ ...options });
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
    abort: (staged: StagedManagedAgentNamespace<MemoryAgentResourceNamespace>) => {
      const allocation = this.#allocation(staged);
      if (staged.phase !== 'staged' || allocation.namespace.phase !== 'staged') invalidNamespace();
      this.#allocations.delete(staged.agentId);
      return Promise.resolve();
    },
    resolve: (agentId: AgentId) => {
      const namespace = this.#allocations.get(parseAgentId(agentId))?.namespace;
      return Promise.resolve(namespace?.phase === 'published' ? namespace : undefined);
    },
    list: () => {
      const published: ManagedAgentNamespace<MemoryAgentResourceNamespace>[] = [];
      for (const { namespace } of this.#allocations.values()) {
        if (namespace.phase === 'published') published.push(namespace);
      }
      published.sort((left, right) => left.agentId.localeCompare(right.agentId));
      return Promise.resolve(Object.freeze(published));
    },
  });

  readonly createAuthorityPorts: MemoryStandaloneResourceProvisioner['createAuthorityPorts'] = (
    namespace
  ) => {
    const allocation = this.#allocation(namespace);
    allocation.authority ??= Object.freeze({
      identityCatalog: new MemoryAgentIdentityCatalogAdapter(this.#options),
      config: new MemoryAgentConfigAdapter(),
    });
    return allocation.authority;
  };

  readonly createRuntimePorts: MemoryStandaloneResourceProvisioner['createRuntimePorts'] = ({
    namespace,
  }) => {
    const { session, requestJournal } = this.#persistence(namespace);
    return Object.freeze({ session, requestJournal });
  };

  readonly createSessionManagementPorts: MemoryStandaloneResourceProvisioner['createSessionManagementPorts'] =
    (namespace) => {
      const { session, maintenance } = this.#persistence(namespace);
      return Object.freeze({ session, maintenance });
    };

  readonly createSessionNavigationPorts: MemoryStandaloneResourceProvisioner['createSessionNavigationPorts'] =
    (namespace) => {
      const { session } = this.#persistence(namespace);
      return Object.freeze({ session });
    };

  #stage(
    agentIdInput: AgentId
  ): Promise<StagedManagedAgentNamespace<MemoryAgentResourceNamespace>> {
    const agentId = parseAgentId(agentIdInput);
    // Memory has no interrupted process to resume. A live reservation is exclusive until abort.
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
    this.#allocations.set(agentId, { namespace });
    return Promise.resolve(namespace);
  }

  #allocation(
    namespace: ManagedAgentNamespaceReference<MemoryAgentResourceNamespace>
  ): MemoryAllocation {
    const allocation = this.#allocations.get(parseAgentId(namespace.agentId));
    if (allocation === undefined || allocation.namespace.handle.token !== namespace.handle.token) {
      return invalidNamespace();
    }
    return allocation;
  }

  #persistence(
    namespace: ManagedAgentNamespace<MemoryAgentResourceNamespace>
  ): CoordinatedSessionPersistence {
    const allocation = this.#allocation(namespace);
    if (namespace.phase !== 'published' || allocation.namespace.phase !== 'published') {
      return invalidNamespace();
    }
    allocation.persistence ??= createMemorySessionPersistence(this.#options);
    return allocation.persistence;
  }
}

export function createMemoryStandaloneResourceProvisioner(
  options: Readonly<{ clock?: () => number }>
): MemoryStandaloneResourceProvisioner {
  const scope = new MemoryResourceScope(options);
  return Object.freeze({
    namespacePort: scope.namespacePort,
    createAuthorityPorts: scope.createAuthorityPorts,
    createRuntimePorts: scope.createRuntimePorts,
    createSessionManagementPorts: scope.createSessionManagementPorts,
    createSessionNavigationPorts: scope.createSessionNavigationPorts,
  });
}
