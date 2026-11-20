import type { AgentId, AgentIdentity } from '../../types/identity.js';
import type {
  AgentIdentityCatalogPort,
  AgentIdentityCatalogReadPort,
  RenameAgentIdentityRequest,
} from './ports.js';

export interface RenameAgentIdentityOptions extends RenameAgentIdentityRequest {
  readonly catalog: AgentIdentityCatalogPort;
}

export interface CreateAgentIdentityOptions {
  readonly identity: AgentIdentity;
  readonly catalog: AgentIdentityCatalogPort;
}

export interface ReadAgentIdentityOptions {
  readonly agentId: AgentId;
  readonly catalog: AgentIdentityCatalogReadPort;
}

export interface TransitionAgentIdentityOptions extends ReadAgentIdentityOptions {
  readonly catalog: AgentIdentityCatalogPort;
  readonly expectedRevision: number;
}
