declare const agentIdBrand: unique symbol;

export type AgentId = string & { readonly [agentIdBrand]: 'AgentId' };

export interface AgentIdentity {
  readonly id: AgentId;
  readonly displayName: string;
}

export interface AgentIdentityInput {
  readonly id: string;
  readonly displayName?: string;
}
