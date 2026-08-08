import { AgentSessionError } from './errors.js';
import type { SessionBranchId, SessionId, TurnId } from './types.js';

const SESSION_ID_MAX_LENGTH = 128;
const SESSION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;
const TURN_ID_MAX_LENGTH = 128;
const TURN_ID_PATTERN = SESSION_ID_PATTERN;
const SESSION_BRANCH_ID_MAX_LENGTH = 128;
const SESSION_BRANCH_ID_PATTERN = SESSION_ID_PATTERN;
const FAILURE_CODE_MAX_LENGTH = 128;
const FAILURE_CODE_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

export function parseSessionId(value: unknown): SessionId {
  if (
    typeof value !== 'string' ||
    value.length > SESSION_ID_MAX_LENGTH ||
    !SESSION_ID_PATTERN.test(value)
  ) {
    throw new AgentSessionError(
      'SESSION_ID_INVALID',
      `Session ID must contain 1-${SESSION_ID_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value as SessionId;
}

export function parseTurnId(value: unknown): TurnId {
  if (
    typeof value !== 'string' ||
    value.length > TURN_ID_MAX_LENGTH ||
    !TURN_ID_PATTERN.test(value)
  ) {
    throw new AgentSessionError(
      'TURN_ID_INVALID',
      `Turn ID must contain 1-${TURN_ID_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value as TurnId;
}

export function parseSessionBranchId(value: unknown): SessionBranchId {
  if (
    typeof value !== 'string' ||
    value.length > SESSION_BRANCH_ID_MAX_LENGTH ||
    !SESSION_BRANCH_ID_PATTERN.test(value)
  ) {
    throw new AgentSessionError(
      'SESSION_BRANCH_ID_INVALID',
      `Session branch ID must contain 1-${SESSION_BRANCH_ID_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value as SessionBranchId;
}

export const DEFAULT_SESSION_BRANCH_ID = parseSessionBranchId('main');

export function parseSessionFailureCode(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > FAILURE_CODE_MAX_LENGTH ||
    !FAILURE_CODE_PATTERN.test(value)
  ) {
    throw new AgentSessionError(
      'SESSION_FAILURE_CODE_INVALID',
      `Session failure code must contain 1-${FAILURE_CODE_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value;
}
