import type { AgentIdentity } from '../../types/identity.js';

export type AgentIdentityStatus = 'active' | 'disabled';

export interface AgentIdentitySnapshot {
  readonly identity: AgentIdentity;
  readonly status: AgentIdentityStatus;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}
