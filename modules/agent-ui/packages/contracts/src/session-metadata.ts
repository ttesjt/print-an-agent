import type { SessionDetails, SessionManagementResult, SessionRevision } from './session-types.js';

export interface RenameSessionInput {
  readonly agentId: string;
  readonly expectedRevision: SessionRevision;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly title: string;
}

export interface SessionMetadataPort {
  renameSession(input: RenameSessionInput): Promise<SessionManagementResult<SessionDetails>>;
}
