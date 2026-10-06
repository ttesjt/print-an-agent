import {
  ManagedAgentNamespaceError,
  createAgentManagementService,
  createAgentRuntimeService,
  defineManagedAgentComposition,
  type ManagedAgentNamespace,
  type ManagedAgentNamespacePort,
  type ManagedAgentNamespaceReference,
  type ManagedAgentRuntimeMaterializationInput,
  type StagedManagedAgentNamespace,
} from '@ta-agent/base-composition';
import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@ta-agent/base-local-adapters';
import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import {
  defineStandaloneAgentConfig,
  materializeStandaloneAgentRuntime,
  STANDALONE_AGENT_CONFIG_CODEC,
  type StandaloneAgentConfig,
  type StandaloneRuntimePorts,
} from '@ta-agent/base-standalone-agent';
import { describe, expect, it } from 'vitest';

interface OpaqueNamespaceHandle {
  readonly token: symbol;
}

interface OpaqueResources {
  readonly identities: MemoryAgentIdentityCatalogAdapter;
  readonly configs: MemoryAgentConfigAdapter;
  readonly sessions: MemorySessionAdapter;
  readonly journal: MemoryRequestJournalAdapter;
}

function createOpaqueResourceProfile(): Readonly<{
  namespaces: ManagedAgentNamespacePort<OpaqueNamespaceHandle>;
  resources: ReadonlyMap<symbol, OpaqueResources>;
}> {
  const published = new Map<AgentId, ManagedAgentNamespace<OpaqueNamespaceHandle>>();
  const staged = new Map<AgentId, StagedManagedAgentNamespace<OpaqueNamespaceHandle>>();
  const resources = new Map<symbol, OpaqueResources>();
  const namespaces: ManagedAgentNamespacePort<OpaqueNamespaceHandle> = Object.freeze({
    stage: (agentIdInput: AgentId) => {
      const agentId = parseAgentId(agentIdInput);
      if (published.has(agentId)) {
        throw new ManagedAgentNamespaceError(
          'MANAGED_AGENT_NAMESPACE_ALREADY_EXISTS',
          'Opaque Agent namespace already exists.'
        );
      }
      const existing = staged.get(agentId);
      if (existing !== undefined) {
        return Promise.resolve(Object.freeze({ ...existing, resumed: true }));
      }
      const handle = Object.freeze({ token: Symbol(agentId) });
      const namespace = Object.freeze({
        agentId,
        phase: 'staged' as const,
        resumed: false,
        handle,
      });
      staged.set(agentId, namespace);
      resources.set(
        handle.token,
        Object.freeze({
          identities: new MemoryAgentIdentityCatalogAdapter(),
          configs: new MemoryAgentConfigAdapter(),
          sessions: new MemorySessionAdapter(),
          journal: new MemoryRequestJournalAdapter(),
        })
      );
      return Promise.resolve(namespace);
    },
    publish: (namespace: StagedManagedAgentNamespace<OpaqueNamespaceHandle>) => {
      const publishedNamespace = Object.freeze({
        agentId: namespace.agentId,
        phase: 'published' as const,
        handle: namespace.handle,
      });
      staged.delete(namespace.agentId);
      published.set(namespace.agentId, publishedNamespace);
      return Promise.resolve(publishedNamespace);
    },
    abort: (namespace: StagedManagedAgentNamespace<OpaqueNamespaceHandle>) => {
      staged.delete(namespace.agentId);
      resources.delete(namespace.handle.token);
      return Promise.resolve();
    },
    resolve: (agentId: AgentId) => Promise.resolve(published.get(parseAgentId(agentId))),
    list: () => Promise.resolve(Object.freeze([...published.values()])),
  });
  return Object.freeze({ namespaces, resources });
}

describe('public managed resource consumer', () => {
  it('uses generic management plus the Standalone materializer over opaque resources', async () => {
    const profile = createOpaqueResourceProfile();
    const definition = defineManagedAgentComposition({
      config: { codec: STANDALONE_AGENT_CONFIG_CODEC },
      namespace: { port: profile.namespaces },
      authority: {
        createPorts: (namespace: ManagedAgentNamespaceReference<OpaqueNamespaceHandle>) => {
          const resource = profile.resources.get(namespace.handle.token);
          if (resource === undefined) throw new Error('Opaque Agent resources are unavailable.');
          return Object.freeze({
            identityCatalog: resource.identities,
            config: resource.configs,
          });
        },
      },
      runtime: {
        createPorts: ({ namespace }) => {
          const resource = profile.resources.get(namespace.handle.token);
          if (resource === undefined) throw new Error('Opaque Agent resources are unavailable.');
          return Object.freeze({ session: resource.sessions, requestJournal: resource.journal });
        },
        materialize: ({
          identity,
          config,
          ports,
        }: ManagedAgentRuntimeMaterializationInput<
          StandaloneAgentConfig,
          StandaloneRuntimePorts
        >) =>
          materializeStandaloneAgentRuntime({
            identity,
            config,
            ports,
            options: { readEnvironmentVariable: () => undefined },
          }),
      },
    });
    const management = createAgentManagementService(definition);
    const runtime = createAgentRuntimeService(definition);
    const created = await management.create({
      identity: { id: 'opaque-consumer', displayName: 'Opaque Consumer' },
      config: defineStandaloneAgentConfig({
        provider: {
          config: {
            kind: 'openai-compatible',
            reference: {
              provider: 'loopback',
              model: 'qualification-model',
              baseUrl: 'http://127.0.0.1:8080/v1',
            },
            contextWindowTokens: 8_192,
            maxOutputTokens: 1_024,
            supportsReasoning: false,
            compatibility: { supportsDeveloperRole: false },
          },
        },
      }),
    });

    expect(created).toMatchObject({
      identity: { identity: { id: 'opaque-consumer' }, status: 'active' },
      config: { revision: 1 },
      projection: { kind: 'not-configured' },
    });
    await expect(runtime.open(parseAgentId('opaque-consumer'))).resolves.toMatchObject({
      identity: { id: 'opaque-consumer' },
    });
    expect(await management.list()).toHaveLength(1);
  });
});
