import { AgentRequestError } from '../errors.js';
import type { RequestJournalFailure } from './contracts.js';
import { defineRequestJournalFailure } from './identifiers.js';

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
