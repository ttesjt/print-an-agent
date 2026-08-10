import { resolveAgentConfig, writeAgentConfig } from '@ta-agent/base-config';
import {
  createAgentIdentity,
  disableAgentIdentity,
  parseAgentId,
  reactivateAgentIdentity,
  readAgentIdentity,
  type AgentId,
  type AgentIdentity,
  type AgentIdentitySnapshot,
} from '@ta-agent/base-identity';
import {
  defineStandaloneAgentDefinition,
  defineStandaloneAgentManifest,
  STANDALONE_AGENT_DEFINITION_CODEC,
} from '../config.js';
import { AgentBaseStandaloneError } from '../errors.js';
import type {
  CreateStandaloneAgentOptions,
  ManagedStandaloneAgentRegistry,
  ManagedStandaloneAgentSnapshot,
  StandaloneAgentDefinition,
  StandaloneAgentManifest,
  StandaloneManifestProjectionStatus,
  TransitionManagedStandaloneAgentRequest,
  UpdateManagedStandaloneAgentConfigRequest,
} from '../types.js';
import type {
  AgentResourceNamespace,
  AgentResourceNamespaceAdapter,
  ManagedAgentAuthorityPorts,
  ManagedAgentResourcePortFactory,
  StagedAgentResourceNamespace,
  StandaloneManifestProjectionPort,
} from './contracts.js';
import { createManagedStandaloneAgent } from './runtime.js';

interface ManagedAgentAuthority {
  readonly identity: AgentIdentitySnapshot;
  readonly config: StandaloneAgentDefinition;
  readonly configRevision: number;
}

export interface CreateManagedStandaloneAgentRegistryOptions<
  TNamespace,
> extends CreateStandaloneAgentOptions {
  readonly namespaces: AgentResourceNamespaceAdapter<TNamespace>;
  readonly ports: ManagedAgentResourcePortFactory<TNamespace>;
  readonly manifestProjection?: StandaloneManifestProjectionPort<TNamespace>;
}

function storageError(message: string, cause?: unknown): AgentBaseStandaloneError {
  return new AgentBaseStandaloneError(message, {
    code: 'STANDALONE_AGENT_STORAGE_INVALID',
    ...(cause === undefined ? {} : { cause }),
  });
}

function assertNamespaceAgentId<TNamespace>(
  namespace: AgentResourceNamespace<TNamespace>,
  expectedAgentId: AgentId
): void {
  if (namespace.agentId !== expectedAgentId) {
    throw storageError('Agent resource namespace returned authority for a different Agent ID.');
  }
}

function createManifest(
  identity: AgentIdentity,
  config: StandaloneAgentDefinition
): StandaloneAgentManifest {
  return Object.freeze({ schemaVersion: 1, identity, config });
}

function sameIdentity(left: AgentIdentity, right: AgentIdentity): boolean {
  return left.id === right.id && left.displayName === right.displayName;
}

function sameConfig(left: StandaloneAgentDefinition, right: StandaloneAgentDefinition): boolean {
  return (
    JSON.stringify(STANDALONE_AGENT_DEFINITION_CODEC.encode(left)) ===
    JSON.stringify(STANDALONE_AGENT_DEFINITION_CODEC.encode(right))
  );
}

function managedSnapshot(
  authority: ManagedAgentAuthority,
  manifestProjection: StandaloneManifestProjectionStatus
): ManagedStandaloneAgentSnapshot {
  return Object.freeze({ ...authority, manifestProjection });
}

async function readAuthority(
  agentId: AgentId,
  ports: ManagedAgentAuthorityPorts
): Promise<ManagedAgentAuthority> {
  const identity = await readAgentIdentity({ agentId, catalog: ports.identityCatalog });
  const resolved = await resolveAgentConfig({
    identity: identity.identity,
    codec: STANDALONE_AGENT_DEFINITION_CODEC,
    adapter: ports.config,
  });
  if (resolved.revision === null) {
    throw storageError('Managed Standalone Agent config must be stored durably.');
  }
  return Object.freeze({
    identity,
    config: resolved.config,
    configRevision: resolved.revision,
  });
}

async function initializeAuthority(
  manifest: StandaloneAgentManifest,
  ports: ManagedAgentAuthorityPorts,
  resumed: boolean
): Promise<ManagedAgentAuthority> {
  const storedIdentity = await ports.identityCatalog.read(manifest.identity.id);
  let identity: AgentIdentitySnapshot;
  if (storedIdentity === undefined) {
    identity = await createAgentIdentity({
      identity: manifest.identity,
      catalog: ports.identityCatalog,
    });
  } else {
    if (
      !resumed ||
      storedIdentity.status !== 'active' ||
      storedIdentity.revision !== 1 ||
      !sameIdentity(storedIdentity.identity, manifest.identity)
    ) {
      throw storageError('Unpublished Agent identity conflicts with the creation manifest.');
    }
    identity = storedIdentity;
  }

  const storedConfig = await ports.config.read(manifest.identity.id);
  if (storedConfig === undefined) {
    const written = await writeAgentConfig({
      identity: identity.identity,
      codec: STANDALONE_AGENT_DEFINITION_CODEC,
      adapter: ports.config,
      config: manifest.config,
      expectedRevision: null,
    });
    if (written.revision === null) {
      throw storageError('Managed Standalone Agent config creation did not produce a revision.');
    }
    return Object.freeze({
      identity,
      config: written.config,
      configRevision: written.revision,
    });
  }

  if (!resumed || storedConfig.revision !== 1) {
    throw storageError('Unpublished Agent config conflicts with the creation manifest.');
  }
  const resolved = await resolveAgentConfig({
    identity: identity.identity,
    codec: STANDALONE_AGENT_DEFINITION_CODEC,
    adapter: ports.config,
  });
  if (resolved.revision !== 1 || !sameConfig(resolved.config, manifest.config)) {
    throw storageError('Unpublished Agent config conflicts with the creation manifest.');
  }
  return Object.freeze({
    identity,
    config: resolved.config,
    configRevision: resolved.revision,
  });
}

async function abortProvision<TNamespace>(
  adapter: AgentResourceNamespaceAdapter<TNamespace>,
  namespace: StagedAgentResourceNamespace<TNamespace>,
  cause: unknown
): Promise<never> {
  try {
    await adapter.abort(namespace);
  } catch (cleanupCause: unknown) {
    throw new AggregateError(
      [cause, cleanupCause],
      'Standalone Agent creation and resource cleanup both failed.'
    );
  }
  throw cause;
}

export function createManagedStandaloneAgentRegistry<TNamespace>(
  options: CreateManagedStandaloneAgentRegistryOptions<TNamespace>
): ManagedStandaloneAgentRegistry {
  const projection = options.manifestProjection;

  const inspectNamespace = async (
    namespace: AgentResourceNamespace<TNamespace>
  ): Promise<ManagedStandaloneAgentSnapshot> => {
    const agentId = parseAgentId(namespace.agentId);
    assertNamespaceAgentId(namespace, agentId);
    const authority = await readAuthority(agentId, options.ports.createAuthorityPorts(namespace));
    const manifest = createManifest(authority.identity.identity, authority.config);
    const projectionStatus =
      projection === undefined ? 'current' : await projection.reconcile(namespace, manifest);
    return managedSnapshot(authority, projectionStatus);
  };

  const resolveNamespace = async (
    agentIdInput: string
  ): Promise<AgentResourceNamespace<TNamespace>> => {
    const agentId = parseAgentId(agentIdInput);
    const namespace = await options.namespaces.resolve(agentId);
    if (namespace === undefined) {
      throw new AgentBaseStandaloneError('Managed Standalone Agent does not exist.', {
        code: 'STANDALONE_AGENT_NOT_FOUND',
      });
    }
    assertNamespaceAgentId(namespace, agentId);
    return namespace;
  };

  return Object.freeze({
    create: async (manifestInput: unknown) => {
      const manifest = defineStandaloneAgentManifest(manifestInput);
      const staged = await options.namespaces.stage(manifest.identity.id);
      assertNamespaceAgentId(staged, manifest.identity.id);
      let published = false;
      try {
        await initializeAuthority(
          manifest,
          options.ports.createAuthorityPorts(staged),
          staged.resumed
        );
        if (projection !== undefined) await projection.publish(staged, manifest);
        const namespace = await options.namespaces.publish(staged);
        published = true;
        assertNamespaceAgentId(namespace, manifest.identity.id);
        return await inspectNamespace(namespace);
      } catch (cause: unknown) {
        if (!published) return await abortProvision(options.namespaces, staged, cause);
        throw cause;
      }
    },
    inspect: async (agentId: string) => inspectNamespace(await resolveNamespace(agentId)),
    list: async () => {
      const namespaces = [...(await options.namespaces.list())];
      const seen = new Set<AgentId>();
      for (const namespace of namespaces) {
        const agentId = parseAgentId(namespace.agentId);
        assertNamespaceAgentId(namespace, agentId);
        if (seen.has(agentId)) {
          throw storageError('Agent resource namespace listing contains a duplicate Agent ID.');
        }
        seen.add(agentId);
      }
      namespaces.sort((left, right) => left.agentId.localeCompare(right.agentId));
      return Object.freeze(await Promise.all(namespaces.map(inspectNamespace)));
    },
    updateConfig: async (request: UpdateManagedStandaloneAgentConfigRequest) => {
      const namespace = await resolveNamespace(request.agentId);
      const current = await readAuthority(
        namespace.agentId,
        options.ports.createAuthorityPorts(namespace)
      );
      const config = defineStandaloneAgentDefinition(request.config);
      const ports = options.ports.createAuthorityPorts(namespace);
      const updated = await writeAgentConfig({
        identity: current.identity.identity,
        codec: STANDALONE_AGENT_DEFINITION_CODEC,
        adapter: ports.config,
        config,
        expectedRevision: request.expectedRevision,
      });
      if (updated.revision === null) {
        throw storageError('Managed Standalone Agent config update did not produce a revision.');
      }
      const authority = Object.freeze({
        identity: current.identity,
        config: updated.config,
        configRevision: updated.revision,
      });
      const manifest = createManifest(authority.identity.identity, authority.config);
      const status =
        projection === undefined ? 'current' : await projection.reconcile(namespace, manifest);
      return managedSnapshot(authority, status);
    },
    disable: async (request: TransitionManagedStandaloneAgentRequest) => {
      const namespace = await resolveNamespace(request.agentId);
      const ports = options.ports.createAuthorityPorts(namespace);
      await disableAgentIdentity({
        agentId: namespace.agentId,
        catalog: ports.identityCatalog,
        expectedRevision: request.expectedRevision,
      });
      return inspectNamespace(namespace);
    },
    reactivate: async (request: TransitionManagedStandaloneAgentRequest) => {
      const namespace = await resolveNamespace(request.agentId);
      const ports = options.ports.createAuthorityPorts(namespace);
      await reactivateAgentIdentity({
        agentId: namespace.agentId,
        catalog: ports.identityCatalog,
        expectedRevision: request.expectedRevision,
      });
      return inspectNamespace(namespace);
    },
    open: async (agentId: string) => {
      const namespace = await resolveNamespace(agentId);
      const snapshot = await inspectNamespace(namespace);
      if (snapshot.identity.status !== 'active') {
        throw new AgentBaseStandaloneError('Managed Standalone Agent is disabled.', {
          code: 'STANDALONE_AGENT_DISABLED',
        });
      }
      return createManagedStandaloneAgent(
        snapshot.identity.identity,
        snapshot.config,
        options.ports.createRuntimePorts(namespace),
        options
      );
    },
  });
}
