import type {
  SessionManagementResult,
  SessionNavigationSnapshot,
  SessionRevision,
} from './session-types.js';

export interface InspectSessionNavigationInput {
  readonly agentId: string;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface SelectSessionBranchInput extends InspectSessionNavigationInput {
  readonly branchId: string;
  readonly expectedRevision: SessionRevision;
}

export interface SessionNavigationPort {
  inspectSessionNavigation(
    input: InspectSessionNavigationInput
  ): Promise<SessionManagementResult<SessionNavigationSnapshot>>;
  selectSessionBranch(
    input: SelectSessionBranchInput
  ): Promise<SessionManagementResult<SessionNavigationSnapshot>>;
}
