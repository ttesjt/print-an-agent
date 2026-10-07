import type {
  SessionDetails,
  SessionLifecycleStatus,
  SessionListPage,
  SessionManagementResult,
  SessionPageCursor,
} from './session-types.js';

export interface ListSessionsInput {
  readonly agentId: string;
  readonly cursor?: SessionPageCursor;
  readonly limit?: number;
  readonly signal?: AbortSignal;
  readonly status: SessionLifecycleStatus;
}

export interface InspectSessionInput {
  readonly agentId: string;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface SessionCatalogPort {
  listSessions(input: ListSessionsInput): Promise<SessionManagementResult<SessionListPage>>;
}

export interface SessionInspectionPort {
  inspectSession(input: InspectSessionInput): Promise<SessionManagementResult<SessionDetails>>;
}
