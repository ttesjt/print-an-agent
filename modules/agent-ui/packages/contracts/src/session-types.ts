export type SessionLifecycleStatus = 'active' | 'retired';
export type SessionRevision = string;
export type SessionPageCursor = string;

interface SessionSummaryBase {
  readonly agentId: string;
  readonly branchCount: number;
  readonly createdAt: string;
  readonly metadataRevision: SessionRevision;
  readonly navigationRevision: SessionRevision;
  readonly selectedBranchId: string;
  readonly sessionId: string;
  readonly title?: string;
  readonly turnCount: number;
  readonly updatedAt: string;
}

export type SessionSummary =
  | Readonly<SessionSummaryBase & { readonly status: 'active' }>
  | Readonly<SessionSummaryBase & { readonly retiredAt: string; readonly status: 'retired' }>;

export type SessionDetails = SessionSummary;

export interface SessionListPage {
  readonly nextCursor?: SessionPageCursor;
  readonly records: readonly SessionSummary[];
}

export interface SessionBranchSummary {
  readonly branchId: string;
  readonly createdAt: string;
  readonly forkedFromTurnId?: string;
  readonly headTurnId?: string;
  readonly parentBranchId?: string;
}

export interface SessionNavigationSnapshot {
  readonly agentId: string;
  readonly branches: readonly SessionBranchSummary[];
  readonly revision: SessionRevision;
  readonly selectedBranchId: string;
  readonly sessionId: string;
}

export interface SessionFieldError {
  readonly field: string;
  readonly message: string;
}

export interface SessionValidationFailure {
  readonly code: 'validation-failed';
  readonly fieldErrors: readonly SessionFieldError[];
  readonly message: string;
}

export interface SessionRevisionConflictFailure {
  readonly code: 'revision-conflict';
  readonly currentRevision: SessionRevision;
  readonly message: string;
}

export interface SessionOperationFailure {
  readonly code:
    | 'invalid-transition'
    | 'not-found'
    | 'operation-failed'
    | 'session-busy'
    | 'unavailable';
  readonly message: string;
}

export type SessionManagementFailure =
  | SessionOperationFailure
  | SessionRevisionConflictFailure
  | SessionValidationFailure;

export type SessionManagementResult<Value> =
  | Readonly<{ readonly failure: SessionManagementFailure; readonly status: 'failed' }>
  | Readonly<{ readonly status: 'succeeded'; readonly value: Value }>;
