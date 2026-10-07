import { describe, expect, it } from 'vitest';
import {
  createAgentIdentity,
  defineAgentIdentity,
  defineAgentIdentitySnapshot,
  disableAgentIdentity,
  listAgentIdentities,
  readAgentIdentity,
  renameAgentIdentity,
  type AgentIdentityCatalogPort,
  type AgentIdentitySnapshot,
} from '../../src/index.js';

function unexpectedCall<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`Unexpected Identity catalog call: ${method}.`));
}

function createCatalogStub(overrides: Partial<AgentIdentityCatalogPort>): AgentIdentityCatalogPort {
  return Object.freeze({
    create: () => unexpectedCall<AgentIdentitySnapshot>('create'),
    read: () => unexpectedCall<AgentIdentitySnapshot | undefined>('read'),
    list: () => unexpectedCall<readonly AgentIdentitySnapshot[]>('list'),
    transition: () => unexpectedCall<AgentIdentitySnapshot>('transition'),
    ...overrides,
  });
}

function snapshot(id: string, revision = 1): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: defineAgentIdentity({ id }),
    status: revision === 1 ? 'active' : 'disabled',
    revision,
    createdAt: 1,
    updatedAt: revision,
  });
}

describe('Agent Identity lifecycle', () => {
  it('rejects unsupported metadata capability and untruthful rename results', async () => {
    const options = {
      agentId: defineAgentIdentity({ id: 'bro' }).id,
      expectedRevision: 1,
      displayName: 'Brother',
    };
    await expect(
      renameAgentIdentity({ ...options, catalog: createCatalogStub({}) })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_METADATA_UNSUPPORTED' });
    await expect(
      renameAgentIdentity({
        ...options,
        catalog: createCatalogStub({
          read: () => Promise.resolve(snapshot('bro')),
          rename: () => Promise.resolve(snapshot('bro', 2)),
        }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
  });
  it('passes creation authority to the catalog and validates its result', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const requests: unknown[] = [];
    const catalog = createCatalogStub({
      create: (request) => {
        requests.push(request);
        return Promise.resolve(snapshot('bro'));
      },
    });

    await expect(createAgentIdentity({ identity, catalog })).resolves.toEqual(snapshot('bro'));
    expect(requests).toEqual([{ identity }]);
  });

  it('rejects missing and cross-Agent catalog results', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });

    await expect(
      readAgentIdentity({
        agentId: identity.id,
        catalog: createCatalogStub({ read: () => Promise.resolve(undefined) }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_NOT_FOUND' });
    await expect(
      readAgentIdentity({
        agentId: identity.id,
        catalog: createCatalogStub({ read: () => Promise.resolve(snapshot('mochi')) }),
      })
    ).rejects.toMatchObject({ code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID' });
  });

  it('requires unique list results ordered by Agent ID', async () => {
    const catalog = createCatalogStub({
      list: () => Promise.resolve([snapshot('zeta'), snapshot('alpha')]),
    });

    await expect(listAgentIdentities(catalog)).rejects.toMatchObject({
      code: 'AGENT_IDENTITY_ADAPTER_RESULT_INVALID',
    });
  });

  it('passes expected revision and target status to lifecycle transitions', async () => {
    const identity = defineAgentIdentity({ id: 'bro' });
    const requests: unknown[] = [];
    const catalog = createCatalogStub({
      transition: (request) => {
        requests.push(request);
        return Promise.resolve(snapshot('bro', 2));
      },
    });

    await expect(
      disableAgentIdentity({ agentId: identity.id, catalog, expectedRevision: 1 })
    ).resolves.toEqual(snapshot('bro', 2));
    expect(requests).toEqual([{ agentId: identity.id, status: 'disabled', expectedRevision: 1 }]);
  });
});
