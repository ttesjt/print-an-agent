import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentRequestError,
  decodeAgentResponse,
  defineRequestJournalFailure,
  parseRequestFingerprint,
  parseRequestIdempotencyKey,
  parseRequestJournalRequestId,
  type RequestJournalEntry,
  type RequestJournalReference,
} from '@print-an-agent/base-request';
import { parseSessionId } from '@print-an-agent/base-session';
import type { SqliteRow } from './types/record.js';

function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentRequestError(
      'REQUEST_REPLAY_RECORD_INVALID',
      `SQLite Request Journal column "${column}" must be a string.`
    );
  }
  return value;
}

function requireTimestamp(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_RECORD_INVALID',
      `SQLite Request Journal column "${column}" must be a non-negative safe integer.`
    );
  }
  return value;
}

export function decodeEntry(row: SqliteRow): RequestJournalEntry {
  let reference: RequestJournalReference;
  try {
    reference = Object.freeze({
      agentId: parseAgentId(requireString(row, 'agent_id')),
      sessionId: parseSessionId(requireString(row, 'session_id')),
      idempotencyKey: parseRequestIdempotencyKey(requireString(row, 'idempotency_key')),
    });
  } catch (cause: unknown) {
    if (cause instanceof AgentRequestError && cause.code === 'REQUEST_REPLAY_RECORD_INVALID') {
      throw cause;
    }
    throw new AgentRequestError(
      'REQUEST_REPLAY_RECORD_INVALID',
      'SQLite Request Journal record contains an invalid namespace.',
      { cause }
    );
  }
  let fingerprint;
  let requestId;
  try {
    fingerprint = parseRequestFingerprint(requireString(row, 'fingerprint'));
    requestId = parseRequestJournalRequestId(requireString(row, 'request_id'));
  } catch (cause: unknown) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_RECORD_INVALID',
      'SQLite Request Journal record contains invalid request authority.',
      { cause }
    );
  }
  const startedAt = requireTimestamp(row, 'started_at');
  const status = requireString(row, 'status');
  if (status === 'active') {
    return Object.freeze({ ...reference, status, fingerprint, requestId, startedAt });
  }
  const finishedAt = requireTimestamp(row, 'finished_at');
  if (status === 'completed') {
    const response = decodeAgentResponse(requireString(row, 'response_json'));
    if (response.requestId !== requestId || response.sessionId !== reference.sessionId) {
      throw new AgentRequestError(
        'REQUEST_REPLAY_RECORD_INVALID',
        'SQLite Request Journal response contradicts its request authority.'
      );
    }
    return Object.freeze({
      ...reference,
      status,
      fingerprint,
      requestId,
      startedAt,
      response,
      finishedAt,
    });
  }
  if (status === 'failed') {
    let failure;
    try {
      failure = defineRequestJournalFailure({
        code: requireString(row, 'failure_code'),
        message: requireString(row, 'failure_message'),
      });
    } catch (cause: unknown) {
      throw new AgentRequestError(
        'REQUEST_REPLAY_RECORD_INVALID',
        'SQLite Request Journal record contains an invalid failure.',
        { cause }
      );
    }
    return Object.freeze({
      ...reference,
      status,
      fingerprint,
      requestId,
      startedAt,
      failure,
      finishedAt,
    });
  }
  throw new AgentRequestError(
    'REQUEST_REPLAY_RECORD_INVALID',
    `SQLite Request Journal record contains unsupported status "${status}".`
  );
}
