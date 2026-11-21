import type { StandaloneSessionReferenceInput } from './session-reference.js';

export interface StandaloneListSessionsInput {
  readonly agentId: string;
  readonly cursor?: Readonly<{ readonly updatedAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface StandaloneListRetiredSessionsInput {
  readonly agentId: string;
  readonly cursor?: Readonly<{ readonly retiredAt: number; readonly sessionId: string }>;
  readonly limit?: number;
}

export interface StandaloneListSessionTurnsInput extends StandaloneSessionReferenceInput {
  readonly beforeTurnId?: string;
  readonly limit?: number;
}

export interface StandaloneSessionLifecycleMutationInput extends StandaloneSessionReferenceInput {
  readonly expectedRevision: number;
}

export interface StandalonePurgeSessionInput extends StandaloneSessionLifecycleMutationInput {
  readonly confirmation: 'permanently-delete-session';
}

export interface StandaloneRecoverSessionExecutionsInput extends StandaloneSessionReferenceInput {
  readonly expectedExecutionRevision: number;
}
