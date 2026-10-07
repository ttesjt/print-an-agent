export type AgentLifecycleStatus = 'active' | 'disabled';

/** Revisions are opaque compare-and-swap tokens. Consumers must not perform arithmetic on them. */
export type AgentRevision = string;

export interface AgentSummary {
  readonly agentId: string;
  readonly displayName: string;
  readonly identityRevision: AgentRevision;
  readonly status: AgentLifecycleStatus;
  readonly updatedAt: string;
}

export interface AgentDetails extends AgentSummary {
  readonly createdAt: string;
}

export interface AgentConfigSnapshot<Config> {
  readonly agentId: string;
  readonly revision: AgentRevision;
  readonly value: Config;
}

export interface AgentSnapshot<Config> {
  readonly config: AgentConfigSnapshot<Config>;
  readonly details: AgentDetails;
}

export interface AgentIdentityDraft {
  readonly agentId: string;
  readonly displayName: string;
}

export interface AgentFieldError {
  readonly field: string;
  readonly message: string;
}

export interface AgentValidationFailure {
  readonly code: 'validation-failed';
  readonly fieldErrors: readonly AgentFieldError[];
  readonly message: string;
}

export interface AgentRevisionConflictFailure {
  readonly code: 'revision-conflict';
  readonly currentRevision: AgentRevision;
  readonly message: string;
}

export interface AgentOperationFailure {
  readonly code:
    | 'already-exists'
    | 'invalid-transition'
    | 'not-found'
    | 'operation-failed'
    | 'unavailable';
  readonly message: string;
}

export type AgentManagementFailure =
  | AgentOperationFailure
  | AgentRevisionConflictFailure
  | AgentValidationFailure;

export type AgentManagementResult<Value> =
  | Readonly<{ status: 'failed'; failure: AgentManagementFailure }>
  | Readonly<{ status: 'succeeded'; value: Value }>;
