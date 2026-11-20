import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { SessionBranchId, SessionId, TurnId } from '@print-an-agent/base-session';

export interface InspectManagedSessionNavigationInput {
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
}

export interface SelectManagedSessionBranchInput extends InspectManagedSessionNavigationInput {
  readonly branchId: SessionBranchId;
  readonly expectedRevision: number;
}

export interface ForkManagedSessionBranchInput extends InspectManagedSessionNavigationInput {
  readonly sourceBranchId: SessionBranchId;
  readonly throughTurnId: TurnId;
  readonly newBranchId?: SessionBranchId;
  readonly expectedRevision: number;
}

export interface RewindManagedSessionBranchInput extends InspectManagedSessionNavigationInput {
  readonly throughTurnId: TurnId;
  readonly newBranchId?: SessionBranchId;
  readonly expectedRevision: number;
}
