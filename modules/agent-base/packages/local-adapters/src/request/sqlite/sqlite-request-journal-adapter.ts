import { parseAgentId } from '@ta-agent/base-identity';
import { parseSessionId } from '@ta-agent/base-session';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import {
  AgentRequestError,
  decodeAgentResponse,
  defineRequestJournalFailure,
  encodeAgentResponse,
  parseRequestFingerprint,
  parseRequestIdempotencyKey,
  parseRequestJournalRequestId,
  type ActiveRequestJournalEntry,
  type ClaimRequestJournalRequest,
  type CompleteRequestJournalRequest,
  type CompletedRequestJournalEntry,
  type FailRequestJournalRequest,
  type InspectableRequestJournalPort,
  type RequestJournalClaim,
  type RequestJournalEntry,
  type RequestJournalReference,
} from '@ta-agent/base-request';
import {
  defineRequestJournalDatabaseConfiguration,
  readJournalClock,
  runImmediateTransaction,
  useRequestJournalDatabase,
  type RequestJournalDatabaseConfiguration,
} from './database.js';
import {
  assertRequestJournalSchema,
  configureRequestJournalDefensiveMode,
  initializeRequestJournalSchema,
} from './schema.js';
import {
  quoteSqliteIdentifier,
  resolveSqliteRequestJournalTableNames,
  type SqliteRequestJournalTableNames,
  type SqliteRequestJournalTableNamingInput,
} from './table-names.js';

export interface SqliteRequestJournalAdapterOptions extends SqliteRequestJournalTableNamingInput {
  readonly databasePath: string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}

type SqliteRow = Record<string, SQLOutputValue>;

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

function normalizeReference(reference: RequestJournalReference): RequestJournalReference {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
    idempotencyKey: parseRequestIdempotencyKey(reference.idempotencyKey),
  });
}

function decodeEntry(row: SqliteRow): RequestJournalEntry {
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

function selectEntry(
  database: DatabaseSync,
  reference: RequestJournalReference,
  tableNames: SqliteRequestJournalTableNames
): SqliteRow | undefined {
  return database
    .prepare(
      `SELECT agent_id, session_id, idempotency_key, fingerprint, request_id, status,
              response_json, failure_code, failure_message, started_at, finished_at
       FROM ${quoteSqliteIdentifier(tableNames.entries)}
       WHERE agent_id = ? AND session_id = ? AND idempotency_key = ?`
    )
    .get(reference.agentId, reference.sessionId, reference.idempotencyKey) as SqliteRow | undefined;
}

function requireEntry(
  database: DatabaseSync,
  reference: RequestJournalReference,
  tableNames: SqliteRequestJournalTableNames
): RequestJournalEntry {
  const row = selectEntry(database, reference, tableNames);
  if (row === undefined) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_NOT_FOUND',
      `Request Journal entry "${reference.idempotencyKey}" does not exist.`
    );
  }
  return decodeEntry(row);
}

function requireOwner(entry: RequestJournalEntry, requestId: string): void {
  if (entry.requestId !== requestId) {
    throw new AgentRequestError(
      'REQUEST_REPLAY_STATE_INVALID',
      `Request Journal entry is owned by request "${entry.requestId}", not "${requestId}".`
    );
  }
}

export class SqliteRequestJournalAdapter implements InspectableRequestJournalPort {
  readonly #configuration: RequestJournalDatabaseConfiguration;
  readonly #clock: () => number;
  readonly #tableNames: SqliteRequestJournalTableNames;

  constructor(options: SqliteRequestJournalAdapterOptions) {
    this.#tableNames = resolveSqliteRequestJournalTableNames(options);
    this.#configuration = defineRequestJournalDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#clock = options.clock ?? Date.now;
    useRequestJournalDatabase(this.#configuration, 'initialize schema', (database) => {
      initializeRequestJournalSchema(database, this.#tableNames);
      configureRequestJournalDefensiveMode(database);
    });
  }

  claim(request: ClaimRequestJournalRequest): Promise<RequestJournalClaim> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const fingerprint = parseRequestFingerprint(request.fingerprint);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const startedAt = readJournalClock(this.#clock);
      return this.#useDatabase('claim request', (database) =>
        runImmediateTransaction(database, () => {
          const existingRow = selectEntry(database, reference, this.#tableNames);
          if (existingRow !== undefined) {
            const existing = decodeEntry(existingRow);
            if (existing.fingerprint !== fingerprint) {
              throw new AgentRequestError(
                'REQUEST_REPLAY_CONFLICT',
                `Idempotency key "${reference.idempotencyKey}" is already bound to a different request.`
              );
            }
            return Object.freeze({ status: 'existing', entry: existing });
          }

          database
            .prepare(
              `INSERT INTO ${quoteSqliteIdentifier(this.#tableNames.entries)}
                (agent_id, session_id, idempotency_key, fingerprint, request_id, status, started_at)
               VALUES (?, ?, ?, ?, ?, 'active', ?)`
            )
            .run(
              reference.agentId,
              reference.sessionId,
              reference.idempotencyKey,
              fingerprint,
              requestId,
              startedAt
            );
          const entry: ActiveRequestJournalEntry = Object.freeze({
            ...reference,
            status: 'active',
            fingerprint,
            requestId,
            startedAt,
          });
          return Object.freeze({ status: 'claimed', entry });
        })
      );
    });
  }

  complete(request: CompleteRequestJournalRequest): Promise<CompletedRequestJournalEntry> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const responseJson = encodeAgentResponse(request.response);
      const response = decodeAgentResponse(responseJson);
      if (response.requestId !== requestId || response.sessionId !== reference.sessionId) {
        throw new AgentRequestError(
          'REQUEST_REPLAY_STATE_INVALID',
          'Request Journal response does not match the active request authority.'
        );
      }
      const finishedAt = readJournalClock(this.#clock);
      return this.#useDatabase('complete request', (database) =>
        runImmediateTransaction(database, () => {
          const entry = requireEntry(database, reference, this.#tableNames);
          requireOwner(entry, requestId);
          if (entry.status !== 'active') {
            throw new AgentRequestError(
              'REQUEST_REPLAY_STATE_INVALID',
              `Request Journal entry cannot complete from state "${entry.status}".`
            );
          }
          const result = database
            .prepare(
              `UPDATE ${quoteSqliteIdentifier(this.#tableNames.entries)}
               SET status = 'completed', response_json = ?, finished_at = ?
               WHERE agent_id = ? AND session_id = ? AND idempotency_key = ?
                 AND request_id = ? AND status = 'active'`
            )
            .run(
              responseJson,
              finishedAt,
              reference.agentId,
              reference.sessionId,
              reference.idempotencyKey,
              requestId
            );
          if (result.changes !== 1) {
            throw new AgentRequestError(
              'REQUEST_REPLAY_STATE_INVALID',
              'Request Journal entry was not active when completion was committed.'
            );
          }
          return Object.freeze({
            ...entry,
            status: 'completed',
            response,
            finishedAt,
          });
        })
      );
    });
  }

  fail(request: FailRequestJournalRequest): Promise<RequestJournalEntry> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const failure = defineRequestJournalFailure(request.failure);
      const finishedAt = readJournalClock(this.#clock);
      return this.#useDatabase('fail request', (database) =>
        runImmediateTransaction(database, () => {
          const entry = requireEntry(database, reference, this.#tableNames);
          requireOwner(entry, requestId);
          if (entry.status !== 'active') return entry;
          const result = database
            .prepare(
              `UPDATE ${quoteSqliteIdentifier(this.#tableNames.entries)}
               SET status = 'failed', failure_code = ?, failure_message = ?, finished_at = ?
               WHERE agent_id = ? AND session_id = ? AND idempotency_key = ?
                 AND request_id = ? AND status = 'active'`
            )
            .run(
              failure.code,
              failure.message,
              finishedAt,
              reference.agentId,
              reference.sessionId,
              reference.idempotencyKey,
              requestId
            );
          if (result.changes !== 1) {
            throw new AgentRequestError(
              'REQUEST_REPLAY_STATE_INVALID',
              'Request Journal entry was not active when failure was committed.'
            );
          }
          return Object.freeze({ ...entry, status: 'failed', failure, finishedAt });
        })
      );
    });
  }

  inspect(referenceInput: RequestJournalReference): Promise<RequestJournalEntry | undefined> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(referenceInput);
      return this.#useDatabase('inspect request', (database) => {
        const row = selectEntry(database, reference, this.#tableNames);
        return row === undefined ? undefined : decodeEntry(row);
      });
    });
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useRequestJournalDatabase(this.#configuration, operation, (database) => {
      assertRequestJournalSchema(database, this.#tableNames);
      configureRequestJournalDefensiveMode(database);
      return action(database);
    });
  }
}
