import { AgentRequestError } from '../errors.js';
import type {
  RequestFingerprint,
  RequestIdempotencyKey,
  RequestJournalFailure,
} from './contracts.js';

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;
const REQUEST_FINGERPRINT_PATTERN = /^request-v1:sha256:[a-f0-9]{64}$/;
const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = IDEMPOTENCY_KEY_PATTERN;
const FAILURE_CODE_MAX_LENGTH = 128;
const FAILURE_CODE_PATTERN = IDEMPOTENCY_KEY_PATTERN;
const FAILURE_MESSAGE_MAX_LENGTH = 2_048;

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

export function parseRequestFingerprint(value: unknown): RequestFingerprint {
  if (typeof value !== 'string' || !REQUEST_FINGERPRINT_PATTERN.test(value)) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_FINGERPRINT_INVALID',
      'Request replay fingerprint must use the supported request-v1:sha256 format with a lowercase hexadecimal digest.'
    );
  }
  return value as RequestFingerprint;
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
