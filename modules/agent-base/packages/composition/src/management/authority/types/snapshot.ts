import type { AgentIdentitySnapshot } from '@print-an-agent/base-identity-config/identity';

export interface ManagedAgentConfigSnapshot<TConfig> {
  readonly value: TConfig;
  readonly revision: number;
}

export interface ManagedAgentAuthoritySnapshot<TConfig> {
  readonly identity: AgentIdentitySnapshot;
  readonly config: ManagedAgentConfigSnapshot<TConfig>;
}

/** Internal shorthand for the same authoritative snapshot contract. */
export type ManagedAgentAuthority<TConfig> = ManagedAgentAuthoritySnapshot<TConfig>;
