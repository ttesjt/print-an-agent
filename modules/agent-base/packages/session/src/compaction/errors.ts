import { AgentSessionError } from '../errors.js';
import type { SessionCompactionRejectionReason } from './rejection-reasons.js';

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

export class SessionCompactionStepNotImplementedError extends AgentSessionError {
  readonly stepName: string;

  constructor(stepName: string) {
    super(
      'SESSION_COMPACTION_NOT_CONFIGURED',
      `Session compaction step "${stepName}" requires an explicit implementation.`
    );
    this.name = 'SessionCompactionStepNotImplementedError';
    this.stepName = stepName;
  }
}
