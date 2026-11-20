import {
  defineAgentIdentity,
  defineAgentIdentitySnapshot,
  type AgentIdentityCatalogPort,
  type AgentIdentitySnapshot,
  type AgentIdentityStatus,
} from '@print-an-agent/base-identity-config/identity';

function unexpectedCall<T>(method: string): Promise<T> {
  return Promise.reject(new Error(`Unexpected Identity catalog call: ${method}.`));
}

export function createCatalogStub(
  overrides: Partial<AgentIdentityCatalogPort>
): AgentIdentityCatalogPort {
  return Object.freeze({
    create: () => unexpectedCall<AgentIdentitySnapshot>('create'),
    read: () => unexpectedCall<AgentIdentitySnapshot | undefined>('read'),
    list: () => unexpectedCall<readonly AgentIdentitySnapshot[]>('list'),
    transition: () => unexpectedCall<AgentIdentitySnapshot>('transition'),
    ...overrides,
  });
}

export function snapshot(
  id: string,
  revision = 1,
  status: AgentIdentityStatus = 'active'
): AgentIdentitySnapshot {
  return defineAgentIdentitySnapshot({
    identity: defineAgentIdentity({ id }),
    status,
    revision,
    createdAt: 1,
    updatedAt: revision,
  });
}
