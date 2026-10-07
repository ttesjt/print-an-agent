import type {
  AgentId,
  AgentIdentity,
  AgentIdentitySnapshot,
  AgentIdentityStatus,
} from '../types/identity.js';

export interface CreateAgentIdentityRequest {
  readonly identity: AgentIdentity;
}

export interface TransitionAgentIdentityRequest {
  readonly agentId: AgentId;
  readonly status: AgentIdentityStatus;
  readonly expectedRevision: number;
}

export interface AgentIdentityCatalogReadPort {
  read(agentId: AgentId): Promise<AgentIdentitySnapshot | undefined>;
  list(): Promise<readonly AgentIdentitySnapshot[]>;
}

export interface AgentIdentityCatalogPort extends AgentIdentityCatalogReadPort {
  create(request: CreateAgentIdentityRequest): Promise<AgentIdentitySnapshot>;
  transition(request: TransitionAgentIdentityRequest): Promise<AgentIdentitySnapshot>;
  /** Optional metadata capability; lifecycle-only custom catalogs remain valid. */
  rename?: (request: RenameAgentIdentityRequest) => Promise<AgentIdentitySnapshot>;
}

export interface RenameAgentIdentityRequest {
  readonly agentId: AgentId;
  readonly displayName: string;
  readonly expectedRevision: number;
}

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
