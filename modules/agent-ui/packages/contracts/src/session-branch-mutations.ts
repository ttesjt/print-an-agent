import type {
  SessionManagementResult,
  SessionNavigationSnapshot,
  SessionRevision,
} from './session-types.js';

interface SessionBranchMutationInput {
  readonly agentId: string;
  readonly expectedRevision: SessionRevision;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly throughTurnId: string;
}

export interface ForkSessionBranchInput extends SessionBranchMutationInput {
  readonly newBranchId?: string;
  readonly sourceBranchId: string;
}

export interface RewindSessionBranchInput extends SessionBranchMutationInput {
  readonly newBranchId?: string;
}

export interface SessionBranchMutationResult {
  readonly affectedBranchId: string;
  readonly navigation: SessionNavigationSnapshot;
}

/** Optional capability installed only when turn-level navigation is supported. */
export interface SessionBranchMutationPort {
  forkSessionBranch(
    input: ForkSessionBranchInput
  ): Promise<SessionManagementResult<SessionBranchMutationResult>>;
  rewindSessionBranch(
    input: RewindSessionBranchInput
  ): Promise<SessionManagementResult<SessionBranchMutationResult>>;
}
