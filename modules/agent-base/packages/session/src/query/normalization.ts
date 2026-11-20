import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { parseSessionId, parseTurnId } from '../contracts/index.js';
import { AgentSessionError } from '../errors.js';
import { DEFAULT_SESSION_QUERY_LIMIT, MAX_SESSION_QUERY_LIMIT } from './limits.js';
import type { ListSessionsInput, NormalizedListSessionsInput } from './types/list.js';
import type { ListSessionTurnsInput, NormalizedListSessionTurnsInput } from './types/turns.js';

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_SESSION_QUERY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SESSION_QUERY_LIMIT) {
    throw new AgentSessionError(
      'SESSION_QUERY_INVALID',
      `Session query limit must be a safe integer between 1 and ${MAX_SESSION_QUERY_LIMIT}.`
    );
  }
  return limit;
}

function normalizeTimestamp(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentSessionError(
      'SESSION_QUERY_INVALID',
      `${path} must be a non-negative safe integer.`
    );
  }
  return value;
}

export function normalizeListSessionsInput(input: ListSessionsInput): NormalizedListSessionsInput {
  const cursor = input.cursor;
  return Object.freeze({
    agentId: parseAgentId(input.agentId),
    ...(cursor === undefined
      ? {}
      : {
          cursor: Object.freeze({
            updatedAt: normalizeTimestamp(cursor.updatedAt, 'Session query cursor updatedAt'),
            sessionId: parseSessionId(cursor.sessionId),
          }),
        }),
    limit: normalizeLimit(input.limit),
  });
}

export function normalizeListSessionTurnsInput(
  input: ListSessionTurnsInput
): NormalizedListSessionTurnsInput {
  return Object.freeze({
    agentId: parseAgentId(input.agentId),
    sessionId: parseSessionId(input.sessionId),
    ...(input.beforeTurnId === undefined ? {} : { beforeTurnId: parseTurnId(input.beforeTurnId) }),
    limit: normalizeLimit(input.limit),
  });
}
