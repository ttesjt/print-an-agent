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
