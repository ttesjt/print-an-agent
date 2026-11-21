import type {
  SessionBranchForkOutcome,
  SessionBranchRewindOutcome,
  SessionBranchSelectionOutcome,
  SessionNavigationInspectionOutcome,
} from '@print-an-agent/base-composition';
import type { SessionNavigationOperationOptions } from '@print-an-agent/base-session';

/** String-input projection of the generic out-of-band Session navigation Service. */
export interface StandaloneSessionNavigationService {
  inspect(
    input: StandaloneSessionNavigationReferenceInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionNavigationInspectionOutcome>;
  select(
    input: StandaloneSelectSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchSelectionOutcome>;
  fork(
    input: StandaloneForkSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchForkOutcome>;
  rewind(
    input: StandaloneRewindSessionBranchInput,
    options?: SessionNavigationOperationOptions
  ): Promise<SessionBranchRewindOutcome>;
}

export interface StandaloneSessionNavigationReferenceInput {
  readonly agentId: string;
  readonly sessionId: string;
}

export interface StandaloneSelectSessionBranchInput extends StandaloneSessionNavigationReferenceInput {
  readonly branchId: string;
  readonly expectedRevision: number;
}

export interface StandaloneForkSessionBranchInput extends StandaloneSessionNavigationReferenceInput {
  readonly sourceBranchId: string;
  readonly throughTurnId: string;
  readonly newBranchId?: string;
  readonly expectedRevision: number;
}

export interface StandaloneRewindSessionBranchInput extends StandaloneSessionNavigationReferenceInput {
  readonly throughTurnId: string;
  readonly newBranchId?: string;
  readonly expectedRevision: number;
}
