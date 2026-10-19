import { AgentSessionError } from '../errors.js';
import type { SessionCompactionRejectionReason } from './planning/contracts.js';

export interface SessionCompactionExhaustion {
  readonly generationAttempts: number;
  readonly reason: SessionCompactionRejectionReason;
  readonly actualTokens?: number;
  readonly targetTokens: number;
}

export class SessionCompactionAttemptsExhaustedError extends AgentSessionError {
  readonly generationAttempts: number;
  readonly reason: SessionCompactionRejectionReason;
  readonly actualTokens: number | undefined;
  readonly targetTokens: number;

  constructor(details: SessionCompactionExhaustion, options?: ErrorOptions) {
    super(
      'SESSION_COMPACTION_ATTEMPTS_EXHAUSTED',
      'Compaction exhausted its bounded generation attempts.',
      options
    );
    this.generationAttempts = details.generationAttempts;
    this.reason = details.reason;
    this.actualTokens = details.actualTokens;
    this.targetTokens = details.targetTokens;
  }
}
