import { parseAgentId } from '@ta-agent/base-identity';
import { AgentSessionError } from '../errors.js';
import { parseSessionId, parseTurnId } from '../identifiers.js';
import type { ListSessionsInput, ListSessionTurnsInput, SessionListCursor } from './contracts.js';
import { DEFAULT_SESSION_QUERY_LIMIT, MAX_SESSION_QUERY_LIMIT } from './contracts.js';

export interface NormalizedListSessionsInput {
  readonly agentId: ReturnType<typeof parseAgentId>;
  readonly cursor?: SessionListCursor;
  readonly limit: number;
}

export interface NormalizedListSessionTurnsInput {
  readonly agentId: ReturnType<typeof parseAgentId>;
  readonly sessionId: ReturnType<typeof parseSessionId>;
  readonly beforeTurnId?: ReturnType<typeof parseTurnId>;
  readonly limit: number;
}

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
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AgentSessionError(
      'SESSION_QUERY_INVALID',
      `${path} must be a non-negative safe integer.`
    );
  }
  return value as number;
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
