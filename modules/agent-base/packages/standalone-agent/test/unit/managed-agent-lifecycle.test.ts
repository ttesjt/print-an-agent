import {
  MemoryAgentConfigAdapter,
  MemoryAgentIdentityCatalogAdapter,
  MemoryRequestJournalAdapter,
  MemorySessionAdapter,
} from '@ta-agent/base-local-adapters';
import { parseAgentId, type AgentId } from '@ta-agent/base-identity';
import { describe, expect, it } from 'vitest';
import {
  AgentBaseStandaloneError,
  createManagedStandaloneAgentRegistry,
  type AgentResourceNamespace,
  type AgentResourceNamespaceAdapter,
  type ManagedAgentResourcePortFactory,
  type StagedAgentResourceNamespace,
  type StandaloneAgentManifestInput,
} from '../../src/index.js';

interface TestNamespace {
  readonly slot: number;
}

function manifest(id: string): StandaloneAgentManifestInput {
  return {
    schemaVersion: 1,
    identity: { id, displayName: id.toUpperCase() },
    config: {
      provider: {
        kind: 'openai-compatible',
        reference: {
          provider: 'loopback',
          model: 'test-model',
          baseUrl: 'http://127.0.0.1:8080/v1',
        },
        contextWindowTokens: 8_192,
        maxOutputTokens: 1_024,
      },
    },
  };
}

function createTestResources(): Readonly<{
  namespaces: AgentResourceNamespaceAdapter<TestNamespace>;
  ports: ManagedAgentResourcePortFactory<TestNamespace>;
}> {
  const published = new Map<AgentId, AgentResourceNamespace<TestNamespace>>();
  const resources = new Map<
    number,
    Readonly<{
      identities: MemoryAgentIdentityCatalogAdapter;
      configs: MemoryAgentConfigAdapter;
      sessions: MemorySessionAdapter;
      journal: MemoryRequestJournalAdapter;
    }>
  >();
  let nextSlot = 0;

  return Object.freeze({
    namespaces: Object.freeze({
      stage: (agentIdInput: AgentId) => {
        const agentId = parseAgentId(agentIdInput);
        if (published.has(agentId)) {
          throw new AgentBaseStandaloneError('Agent already exists.', {
            code: 'STANDALONE_AGENT_ALREADY_EXISTS',
          });
        }
        const handle = Object.freeze({ slot: ++nextSlot });
        resources.set(
          handle.slot,
          Object.freeze({
            identities: new MemoryAgentIdentityCatalogAdapter({ clock: () => handle.slot }),
            configs: new MemoryAgentConfigAdapter(),
            sessions: new MemorySessionAdapter(),
            journal: new MemoryRequestJournalAdapter(() => handle.slot),
          })
        );
        return Promise.resolve(Object.freeze({ agentId, resumed: false, handle }));
      },
      publish: (staged: StagedAgentResourceNamespace<TestNamespace>) => {
        const namespace = Object.freeze({ agentId: staged.agentId, handle: staged.handle });
        published.set(staged.agentId, namespace);
        return Promise.resolve(namespace);
      },
      abort: (staged: StagedAgentResourceNamespace<TestNamespace>) => {
        resources.delete(staged.handle.slot);
        return Promise.resolve();
      },
      resolve: (agentIdInput: AgentId) =>
        Promise.resolve(published.get(parseAgentId(agentIdInput))),
      list: () => Promise.resolve(Object.freeze([...published.values()])),
    }),
    ports: Object.freeze({
      createAuthorityPorts: (namespace: AgentResourceNamespace<TestNamespace>) => {
        const resource = resources.get(namespace.handle.slot);
        if (resource === undefined) throw new Error('Missing test resource.');
        return Object.freeze({
          identityCatalog: resource.identities,
          config: resource.configs,
        });
      },
      createRuntimePorts: (namespace: AgentResourceNamespace<TestNamespace>) => {
        const resource = resources.get(namespace.handle.slot);
        if (resource === undefined) throw new Error('Missing test resource.');
        return Object.freeze({
          session: resource.sessions,
          requestJournal: resource.journal,
        });
      },
    }),
  });
}

describe('storage-neutral managed Agent lifecycle', () => {
  it('composes a managed Agent over opaque non-filesystem namespaces', async () => {
    const resources = createTestResources();
    const registry = createManagedStandaloneAgentRegistry({
      ...resources,
      readEnvironmentVariable: () => undefined,
    });

    const created = await registry.create(manifest('bro'));
    expect(created).toMatchObject({
      identity: { identity: { id: 'bro' }, status: 'active' },
      configRevision: 1,
      manifestProjection: 'current',
    });
    expect((await registry.list()).map((entry) => entry.identity.identity.id)).toEqual(['bro']);

    const updated = await registry.updateConfig({
      agentId: 'bro',
      config: {
        ...manifest('bro').config,
        mainActor: { instructions: 'Keep it short.' },
      },
      expectedRevision: created.configRevision,
    });
    expect(updated.configRevision).toBe(2);
    expect((await registry.open('bro')).agent.identity.id).toBe('bro');

    const disabled = await registry.disable({
      agentId: 'bro',
      expectedRevision: created.identity.revision,
    });
    await expect(registry.open('bro')).rejects.toMatchObject({
      code: 'STANDALONE_AGENT_DISABLED',
    });
    await expect(
      registry.reactivate({ agentId: 'bro', expectedRevision: disabled.identity.revision })
    ).resolves.toMatchObject({ identity: { status: 'active' } });
  });

  it('fails closed when a namespace adapter returns another Agent ID', async () => {
    const resources = createTestResources();
    const registry = createManagedStandaloneAgentRegistry({
      ...resources,
      readEnvironmentVariable: () => undefined,
    });
    await registry.create(manifest('bro'));
    const mismatchedRegistry = createManagedStandaloneAgentRegistry({
      namespaces: Object.freeze({
        ...resources.namespaces,
        resolve: async (agentId: AgentId) => {
          const namespace = await resources.namespaces.resolve(agentId);
          return namespace === undefined
            ? undefined
            : Object.freeze({ agentId: parseAgentId('mochi'), handle: namespace.handle });
        },
      }),
      ports: resources.ports,
      readEnvironmentVariable: () => undefined,
    });

    await expect(mismatchedRegistry.inspect('bro')).rejects.toMatchObject({
      code: 'STANDALONE_AGENT_STORAGE_INVALID',
    });
  });
});
