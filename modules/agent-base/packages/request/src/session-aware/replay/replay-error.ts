import { AgentRequestError } from '../../errors.js';
import { defineRequestJournalFailure } from './failure.js';
import type { RequestJournalFailure } from './types/records.js';

export class RequestReplayFailedError extends AgentRequestError {
  readonly originalFailure: RequestJournalFailure;

  constructor(failure: RequestJournalFailure) {
    const originalFailure = defineRequestJournalFailure(failure);
    super(
      'REQUEST_REPLAY_FAILED',
      `The authoritative request previously failed with "${originalFailure.code}": ${originalFailure.message}`
    );
    this.name = 'RequestReplayFailedError';
    this.originalFailure = originalFailure;
  }
}
