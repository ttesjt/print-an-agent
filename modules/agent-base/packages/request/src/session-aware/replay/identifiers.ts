import { AgentRequestError } from '../../errors.js';
import type { RequestIdempotencyKey } from './types/identity.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = IDEMPOTENCY_KEY_PATTERN;

export function parseRequestIdempotencyKey(value: unknown): RequestIdempotencyKey {
  if (
    typeof value !== 'string' ||
    value.length > IDEMPOTENCY_KEY_MAX_LENGTH ||
    !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    throw new AgentRequestError(
      'REQUEST_IDEMPOTENCY_KEY_INVALID',
      `Request idempotency key must contain 1-${IDEMPOTENCY_KEY_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value as RequestIdempotencyKey;
}

export function parseRequestJournalRequestId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > REQUEST_ID_MAX_LENGTH ||
    !REQUEST_ID_PATTERN.test(value)
  ) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_REQUEST_ID_INVALID',
      `Request Journal request ID must contain 1-${REQUEST_ID_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value;
}
