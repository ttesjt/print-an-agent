import type { AgentId } from '@print-an-agent/base-identity';
import type { SessionBranchId, SessionId, TurnId } from './identifiers.js';

export interface SessionReference {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface SessionBranchReference extends SessionReference {
  readonly branchId: SessionBranchId;
}

export interface ResolvedSessionReference extends SessionBranchReference {
  readonly navigationRevision: number;
}

export interface ResolveSessionRequest {
  readonly agentId: AgentId;
  /** Open an existing Session only. Omit to create with a fresh adapter-generated ID. */
  readonly sessionId?: string;
}

export interface LoadSessionHistoryRequest extends SessionReference {
  readonly beforeTurnId: TurnId;
}
