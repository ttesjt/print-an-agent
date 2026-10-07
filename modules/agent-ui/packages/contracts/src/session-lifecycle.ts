import type { SessionDetails, SessionManagementResult, SessionRevision } from './session-types.js';

export interface ChangeSessionLifecycleInput {
  readonly agentId: string;
  readonly expectedRevision: SessionRevision;
  readonly sessionId: string;
  readonly signal?: AbortSignal;
}

export interface PurgeSessionInput extends ChangeSessionLifecycleInput {
  readonly confirmation: 'permanently-delete-session';
}

export interface SessionLifecyclePort {
  restoreSession(
    input: ChangeSessionLifecycleInput
  ): Promise<SessionManagementResult<SessionDetails>>;
  retireSession(
    input: ChangeSessionLifecycleInput
  ): Promise<SessionManagementResult<SessionDetails>>;
}

export interface SessionPurgePort {
  purgeSession(input: PurgeSessionInput): Promise<SessionManagementResult<void>>;
}
