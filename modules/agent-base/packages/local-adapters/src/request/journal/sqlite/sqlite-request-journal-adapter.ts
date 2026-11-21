import {
  AgentRequestError,
  decodeAgentResponse,
  defineRequestJournalFailure,
  encodeAgentResponse,
  parseRequestFingerprint,
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
} from '@print-an-agent/base-request';
import type { SessionReference, SessionWriteAuthority } from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import {
  assertSqliteSessionWrite,
  resolveSqliteSessionTableNames,
  type SqliteSessionTableNames,
} from '../../../session/index.js';
import { requireJournalOwner } from '../ownership.js';
import { normalizeJournalReference } from '../reference.js';
import {
  defineRequestJournalDatabaseConfiguration,
  readJournalClock,
  runImmediateTransaction,
  useRequestJournalDatabase,
} from './database.js';
import { decodeEntry } from './entry-codec.js';
import { purgeSqliteSessionRequests, recoverSqliteSessionRequests } from './journal-maintenance.js';
import { requireEntry, selectEntry } from './records.js';
import {
  assertRequestJournalSchema,
  configureRequestJournalDefensiveMode,
  initializeRequestJournalSchema,
} from './schema.js';
import { quoteSqliteIdentifier, resolveSqliteRequestJournalTableNames } from './table-names.js';
import type { RequestJournalDatabaseConfiguration } from './types/database.js';
import type { SqliteRequestJournalAdapterOptions } from './types/options.js';
import type { SqliteRequestJournalTableNames } from './types/table-names.js';

export class SqliteRequestJournalAdapter implements InspectableRequestJournalPort {
  readonly #configuration: RequestJournalDatabaseConfiguration;
  readonly #clock: () => number;
  readonly #tableNames: SqliteRequestJournalTableNames;
  readonly #sessionTables: SqliteSessionTableNames | undefined;

  constructor(options: SqliteRequestJournalAdapterOptions) {
    if (
      options.schemaMode !== undefined &&
      options.schemaMode !== 'initialize' &&
      options.schemaMode !== 'existing'
    ) {
      throw new AgentRequestError(
        'REQUEST_REPLAY_CONFIGURATION_INVALID',
        'SQLite Request Journal schema mode is invalid.'
      );
    }
    this.#tableNames = resolveSqliteRequestJournalTableNames(options);
    this.#sessionTables =
      options.sessionExecution === undefined
        ? undefined
        : resolveSqliteSessionTableNames(options.sessionExecution);
    this.#configuration = defineRequestJournalDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#clock = options.clock ?? Date.now;
    useRequestJournalDatabase(this.#configuration, 'initialize schema', (database) => {
      if (options.schemaMode === 'existing') assertRequestJournalSchema(database, this.#tableNames);
      else initializeRequestJournalSchema(database, this.#tableNames);
      configureRequestJournalDefensiveMode(database);
    });
  }

  claim(request: ClaimRequestJournalRequest): Promise<RequestJournalClaim> {
    return Promise.resolve().then(() => {
      const reference = normalizeJournalReference(request);
      const fingerprint = parseRequestFingerprint(request.fingerprint);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const startedAt = readJournalClock(this.#clock);
      return this.#useDatabase('claim request', (database) =>
        runImmediateTransaction(database, () => {
          this.#assertExecution(database, request);
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
      const reference = normalizeJournalReference(request);
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
          this.#assertExecution(database, request);
          const entry = requireEntry(database, reference, this.#tableNames);
          requireJournalOwner(entry, requestId);
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
      const reference = normalizeJournalReference(request);
      const requestId = parseRequestJournalRequestId(request.requestId);
      const failure = defineRequestJournalFailure(request.failure);
      const finishedAt = readJournalClock(this.#clock);
      return this.#useDatabase('fail request', (database) =>
        runImmediateTransaction(database, () => {
          this.#assertExecution(database, request);
          const entry = requireEntry(database, reference, this.#tableNames);
          requireJournalOwner(entry, requestId);
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
      const reference = normalizeJournalReference(referenceInput);
      return this.#useDatabase('inspect request', (database) => {
        const row = selectEntry(database, reference, this.#tableNames);
        return row === undefined ? undefined : decodeEntry(row);
      });
    });
  }

  purgeSessionRequests(reference: SessionReference): Promise<void> {
    return Promise.resolve().then(() =>
      this.#useDatabase('purge session requests', (db) =>
        runImmediateTransaction(db, () =>
          purgeSqliteSessionRequests(db, reference, this.#tableNames)
        )
      )
    );
  }

  recoverSessionRequests(reference: SessionReference): Promise<void> {
    return Promise.resolve().then(() =>
      this.#useDatabase('recover session requests', (db) =>
        runImmediateTransaction(db, () =>
          recoverSqliteSessionRequests(db, reference, this.#clock, this.#tableNames)
        )
      )
    );
  }

  #assertExecution(db: DatabaseSync, request: SessionReference & SessionWriteAuthority): void {
    if (this.#sessionTables !== undefined)
      assertSqliteSessionWrite(db, request, this.#sessionTables);
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useRequestJournalDatabase(this.#configuration, operation, (database) => {
      assertRequestJournalSchema(database, this.#tableNames);
      configureRequestJournalDefensiveMode(database);
      return action(database);
    });
  }
}
