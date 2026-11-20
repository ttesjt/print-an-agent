export { defineAgentIdentity, isAgentId, parseAgentId } from './lib/identity.js';
export {
  createAgentIdentity,
  disableAgentIdentity,
  listAgentIdentities,
  reactivateAgentIdentity,
  readAgentIdentity,
} from './catalog/lifecycle.js';
export { defineAgentIdentitySnapshot, isAgentIdentityStatus } from './catalog/snapshot.js';
export { AgentIdentityError } from './types/errors.js';
export { renameAgentIdentity } from './catalog/metadata.js';
export type {
  CreateAgentIdentityRequest,
  TransitionAgentIdentityRequest,
  AgentIdentityCatalogReadPort,
  AgentIdentityCatalogPort,
  RenameAgentIdentityRequest,
  RenameAgentIdentityOptions,
  CreateAgentIdentityOptions,
  ReadAgentIdentityOptions,
  TransitionAgentIdentityOptions,
} from './catalog/contracts.js';
export type {
  AgentId,
  AgentIdentity,
  AgentIdentityInput,
  AgentIdentitySnapshot,
  AgentIdentityStatus,
} from './types/identity.js';
