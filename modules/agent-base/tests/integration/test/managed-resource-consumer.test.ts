import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@ta-agent/base-local-adapters';
import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import {
  AgentBaseStandaloneError,
  createManagedStandaloneAgentRegistry,
  type AgentResourceNamespace,
  type AgentResourceNamespaceAdapter,
  type ManagedAgentResourcePortFactory,
  type StagedAgentResourceNamespace,
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
  namespaces: AgentResourceNamespaceAdapter<OpaqueNamespaceHandle>;
  ports: ManagedAgentResourcePortFactory<OpaqueNamespaceHandle>;
}> {
  const published = new Map<AgentId, AgentResourceNamespace<OpaqueNamespaceHandle>>();
  const resources = new Map<symbol, OpaqueResources>();
  return Object.freeze({
    namespaces: Object.freeze({
      stage: (agentIdInput: AgentId) => {
        const agentId = parseAgentId(agentIdInput);
        if (published.has(agentId)) {
          throw new AgentBaseStandaloneError('Agent already exists.', {
            code: 'STANDALONE_AGENT_ALREADY_EXISTS',
          });
        }
        const handle = Object.freeze({ token: Symbol(agentId) });
        resources.set(
          handle.token,
          Object.freeze({
            identities: new MemoryAgentIdentityCatalogAdapter(),
            configs: new MemoryAgentConfigAdapter(),
            sessions: new MemorySessionAdapter(),
            journal: new MemoryRequestJournalAdapter(),
          })
        );
        return Promise.resolve(Object.freeze({ agentId, resumed: false, handle }));
      },
      publish: (staged: StagedAgentResourceNamespace<OpaqueNamespaceHandle>) => {
        const namespace = Object.freeze({ agentId: staged.agentId, handle: staged.handle });
        published.set(namespace.agentId, namespace);
        return Promise.resolve(namespace);
      },
      abort: (staged: StagedAgentResourceNamespace<OpaqueNamespaceHandle>) => {
        resources.delete(staged.handle.token);
        return Promise.resolve();
      },
      resolve: (agentId: AgentId) => Promise.resolve(published.get(parseAgentId(agentId))),
      list: () => Promise.resolve(Object.freeze([...published.values()])),
    }),
    ports: Object.freeze({
      createAuthorityPorts: (namespace: AgentResourceNamespace<OpaqueNamespaceHandle>) => {
        const resource = resources.get(namespace.handle.token);
        if (resource === undefined) throw new Error('Opaque Agent resources are unavailable.');
        return Object.freeze({
          identityCatalog: resource.identities,
          config: resource.configs,
        });
      },
      createRuntimePorts: (namespace: AgentResourceNamespace<OpaqueNamespaceHandle>) => {
        const resource = resources.get(namespace.handle.token);
        if (resource === undefined) throw new Error('Opaque Agent resources are unavailable.');
        return Object.freeze({ session: resource.sessions, requestJournal: resource.journal });
      },
    }),
  });
}

describe('public managed resource consumer', () => {
  it('creates and opens an Agent through an opaque non-filesystem resource namespace', async () => {
    const profile = createOpaqueResourceProfile();
    const registry = createManagedStandaloneAgentRegistry({
      ...profile,
      readEnvironmentVariable: () => undefined,
    });
    const created = await registry.create({
      schemaVersion: 1,
      identity: { id: 'opaque-consumer', displayName: 'Opaque Consumer' },
      config: {
        provider: {
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
    });

    expect(created).toMatchObject({
      identity: { identity: { id: 'opaque-consumer' }, status: 'active' },
      configRevision: 1,
      manifestProjection: 'current',
    });
    await expect(registry.open('opaque-consumer')).resolves.toMatchObject({
      agent: { identity: { id: 'opaque-consumer' } },
    });
    expect(await registry.list()).toHaveLength(1);
  });
});
