import { AgentRequestError } from '../../errors.js';
import type { RequestJournalFailure } from './types/records.js';

const FAILURE_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

const FAILURE_CODE_MAX_LENGTH = 128;

const FAILURE_MESSAGE_MAX_LENGTH = 2_048;

export function defineRequestJournalFailure(failure: RequestJournalFailure): RequestJournalFailure {
  if (
    typeof failure.code !== 'string' ||
    failure.code.length > FAILURE_CODE_MAX_LENGTH ||
    !FAILURE_CODE_PATTERN.test(failure.code) ||
    typeof failure.message !== 'string' ||
    failure.message.length === 0 ||
    failure.message.length > FAILURE_MESSAGE_MAX_LENGTH
  ) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_FAILURE_INVALID',
      `Request Journal failure requires a valid bounded code and a 1-${FAILURE_MESSAGE_MAX_LENGTH} character message.`
    );
  }
  return Object.freeze({ code: failure.code, message: failure.message });
}
