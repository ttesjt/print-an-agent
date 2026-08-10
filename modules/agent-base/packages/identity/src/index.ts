export { defineAgentIdentity, isAgentId, parseAgentId } from './lib/identity.js';
export {
  createAgentIdentity,
  disableAgentIdentity,
  listAgentIdentities,
  reactivateAgentIdentity,
  readAgentIdentity,
} from './catalog/lifecycle.js';
export { MemoryAgentIdentityCatalogAdapter } from './catalog/adapters/memory-agent-identity-catalog-adapter.js';
export { SqliteAgentIdentityCatalogAdapter } from './catalog/adapters/sqlite/sqlite-agent-identity-catalog-adapter.js';
export type { SqliteAgentIdentityCatalogAdapterOptions } from './catalog/adapters/sqlite/sqlite-agent-identity-catalog-adapter.js';
export { AgentIdentityError } from './types/errors.js';
export type * from './catalog/contracts.js';
export type {
  AgentId,
  AgentIdentity,
  AgentIdentityInput,
  AgentIdentitySnapshot,
  AgentIdentityStatus,
} from './types/identity.js';
