import { randomUUID } from 'node:crypto';
import { parseAgentId } from '@ta-agent/base-identity';
import type { DatabaseSync } from 'node:sqlite';
import type { ModelMessage } from '@ta-agent/base-model';
import {
  parseSessionId,
  parseTurnId,
  defineSessionTurnPresentation,
  type SessionPresentationPort,
  type CompleteSessionTurnWithPresentationRequest,
  type SessionTurnPresentationReference,
  type SessionTurnPresentationRecord,
  type CommitSessionCompactionRequest,
  type CompactableSessionPort,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type ActiveSessionTurn,
  type BeginSessionTurnRequest,
  type CompleteSessionTurnRequest,
  type CompletedSessionTurn,
  type FailSessionTurnRequest,
  type InspectableSessionPort,
  type LoadSessionHistoryRequest,
  type NavigableSessionPort,
  type ResolveSessionRequest,
  type ResolvedSessionReference,
  type SessionCompaction,
  type SessionBranchReference,
  type SessionContextSnapshot,
  type SessionReference,
  type SessionSnapshot,
  type SessionInspection,
  type SessionMetadataPort,
  type SessionQueryPort,
  type SessionTurnPage,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type SessionTurn,
  type RenameSessionInput,
  type SessionWriteAuthority,
  type SessionExecutionLease,
  type SessionLifecycleMutationInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type ListRetiredSessionsInput,
  type RetiredSessionListPage,
  AgentSessionError,
} from '@ta-agent/base-session';
import {
  defineSqliteDatabaseConfiguration,
  useSqliteDatabase,
  runImmediateTransaction,
  runReadTransaction,
  type SqliteDatabaseConfiguration,
} from './database.js';
import {
  commitSqliteSessionCompaction,
  loadSqliteSessionContext,
  readSqliteSessionCompaction,
} from './session-compaction-storage.js';
import {
  applySqliteSessionNavigation,
  loadSqliteSessionSnapshot,
} from './session-navigation-storage.js';
import { createSqliteSession, openSqliteSession } from './session-resolution.js';
import { normalizeReference } from './session-record-codec.js';
import {
  beginSqliteSessionTurn,
  completeSqliteSessionTurn,
  failSqliteSessionTurn,
  loadSqliteSessionHistory,
} from './session-turn-storage.js';
import {
  inspectSqliteSession,
  listSqliteSessions,
  listSqliteSessionTurns,
  listRetiredSqliteSessions,
} from './session-query-storage.js';
import { renameSqliteSession } from './session-metadata-storage.js';
import {
  readSqliteLifecycle,
  assertSqliteSessionOpen,
  assertSqliteSessionWrite,
  advanceSqliteExecution,
  acquireSqliteExecution,
  releaseSqliteExecution,
  transitionSqliteSession,
  purgeSqliteSession,
  recoverSqliteSession,
} from './session-lifecycle-storage.js';
import { readSqliteTurnPresentation } from './session-presentation-storage.js';
import { assertSessionSchema, configureDefensiveMode, initializeSessionSchema } from './schema.js';
import {
  quoteSqliteIdentifier,
  resolveSqliteSessionTableNames,
  type SqliteSessionTableNames,
  type SqliteSessionTableNamingInput,
} from './table-names.js';

export interface SqliteSessionAdapterOptions extends SqliteSessionTableNamingInput {
  readonly databasePath: string;
  /** Management readers require an existing schema rather than initializing a new table family. */
  readonly schemaMode?: 'initialize' | 'existing';
  /** Must issue fresh, never-reused IDs, including across adapter reconstruction. */
  readonly createSessionId?: () => string;
  readonly createBranchId?: () => string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}

import {
  normalizeResolvedReference,
  normalizeBranchReference,
  normalizeNavigationRequest,
} from './session-input.js';

export class SqliteSessionAdapter
  implements
    InspectableSessionPort,
    CompactableSessionPort,
    NavigableSessionPort,
    SessionQueryPort,
    SessionPresentationPort,
    SessionMetadataPort
{
  readonly #configuration: SqliteDatabaseConfiguration;
  readonly #createSessionId: () => string;
  readonly #createBranchId: () => string;
  readonly #clock: () => number;
  readonly #tableNames: SqliteSessionTableNames;

  constructor(options: SqliteSessionAdapterOptions) {
    if (
      options.schemaMode !== undefined &&
      options.schemaMode !== 'initialize' &&
      options.schemaMode !== 'existing'
    ) {
      throw new AgentSessionError(
        'SESSION_CONFIGURATION_INVALID',
        'SQLite Session schema mode is invalid.'
      );
    }
    this.#tableNames = resolveSqliteSessionTableNames(options);
    this.#configuration = defineSqliteDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#createBranchId = options.createBranchId ?? randomUUID;
    this.#clock = options.clock ?? Date.now;
    useSqliteDatabase(this.#configuration, 'initialize schema', (database) => {
      if (options.schemaMode === 'existing') assertSessionSchema(database, this.#tableNames);
      else initializeSessionSchema(database, this.#tableNames);
      configureDefensiveMode(database);
    });
  }

  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference> {
    return Promise.resolve().then(() => {
      const reference = Object.freeze({
        agentId: parseAgentId(request.agentId),
        sessionId: parseSessionId(
          request.sessionId === undefined ? this.#createSessionId() : request.sessionId
        ),
      });
      return this.#useDatabase('resolve session', (database) => {
        if (request.sessionId !== undefined)
          assertSqliteSessionOpen(database, reference, this.#tableNames);
        return request.sessionId === undefined
          ? createSqliteSession(database, reference, this.#clock, this.#tableNames)
          : openSqliteSession(database, reference, this.#tableNames);
      });
    });
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return Promise.resolve().then(() =>
      this.#write(request, 'begin turn', (database) =>
        beginSqliteSessionTurn(
          database,
          normalizeResolvedReference(request),
          this.#clock,
          this.#tableNames
        )
      )
    );
  }

  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]> {
    return Promise.resolve().then(() => {
      const normalized = {
        ...normalizeReference(request),
        beforeTurnId: parseTurnId(request.beforeTurnId),
      };
      return this.#useDatabase('load history', (database) =>
        loadSqliteSessionHistory(database, normalized, this.#tableNames)
      );
    });
  }

  loadContext(request: LoadSessionHistoryRequest): Promise<SessionContextSnapshot> {
    return Promise.resolve().then(() => {
      const normalized = {
        ...normalizeReference(request),
        beforeTurnId: parseTurnId(request.beforeTurnId),
      };
      return this.#useDatabase('load context', (database) =>
        loadSqliteSessionContext(database, normalized, this.#tableNames)
      );
    });
  }

  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() => {
      const normalized = {
        ...normalizeReference(request),
        turnId: parseTurnId(request.turnId),
        assistantMessage: request.assistantMessage,
      };
      return this.#write(request, 'complete turn', (database) =>
        completeSqliteSessionTurn(database, normalized, this.#clock, this.#tableNames)
      );
    });
  }

  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn> {
    return Promise.resolve().then(() => {
      const normalized = {
        ...normalizeReference(request),
        turnId: parseTurnId(request.turnId),
        failureCode: request.failureCode,
      };
      return this.#write(request, 'fail turn', (database) =>
        failSqliteSessionTurn(database, normalized, this.#clock, this.#tableNames)
      );
    });
  }

  completeTurnWithPresentation(
    request: CompleteSessionTurnWithPresentationRequest
  ): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() => {
      const presentation = defineSessionTurnPresentation(request.presentation);
      const normalized = {
        ...normalizeReference(request),
        turnId: parseTurnId(request.turnId),
        assistantMessage: request.assistantMessage,
      };
      return this.#write(request, 'complete turn with presentation', (database) =>
        completeSqliteSessionTurn(database, normalized, this.#clock, this.#tableNames, presentation)
      );
    });
  }

  readTurnPresentation(
    reference: SessionTurnPresentationReference
  ): Promise<SessionTurnPresentationRecord | undefined> {
    return Promise.resolve().then(() => {
      const normalized = {
        ...normalizeReference(reference),
        turnId: parseTurnId(reference.turnId),
      };
      return this.#useDatabase('read turn presentation', (database) =>
        readSqliteTurnPresentation(database, normalized, this.#tableNames)
      );
    });
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const normalized = normalizeReference(reference);
      return this.#useDatabase('inspect session', (database) => {
        const found = database
          .prepare(
            `SELECT 1 AS found FROM ${quoteSqliteIdentifier(this.#tableNames.sessions)} WHERE agent_id = ? AND session_id = ?`
          )
          .get(normalized.agentId, normalized.sessionId);
        return found === undefined
          ? undefined
          : loadSqliteSessionSnapshot(database, normalized, this.#tableNames);
      });
    });
  }

  listSessions(input: ListSessionsInput): Promise<SessionLifecycleListPage> {
    return Promise.resolve().then(() =>
      this.#useDatabase('list sessions', (database) =>
        listSqliteSessions(database, input, this.#tableNames)
      )
    );
  }

  inspectSession(reference: SessionReference): Promise<SessionLifecycleInspection | undefined> {
    return Promise.resolve().then(() =>
      this.#useDatabase('inspect session', (database) =>
        runReadTransaction(database, () => {
          const summary = inspectSqliteSession(database, reference, this.#tableNames);
          return summary === undefined
            ? undefined
            : Object.freeze({
                ...summary,
                execution: readSqliteLifecycle(database, reference, this.#tableNames).fence,
              });
        })
      )
    );
  }

  listRetiredSessions(input: ListRetiredSessionsInput): Promise<RetiredSessionListPage> {
    return Promise.resolve().then(() =>
      this.#useDatabase('list retired sessions', (db) =>
        runReadTransaction(db, () => listRetiredSqliteSessions(db, input, this.#tableNames))
      )
    );
  }

  retireSession(input: SessionLifecycleMutationInput) {
    return Promise.resolve().then(() =>
      this.#useDatabase('retire session', (db) =>
        transitionSqliteSession(db, input, 'retire', this.#clock, this.#tableNames)
      )
    );
  }

  restoreSession(input: SessionLifecycleMutationInput) {
    return Promise.resolve().then(() =>
      this.#useDatabase('restore session', (db) =>
        transitionSqliteSession(db, input, 'restore', this.#clock, this.#tableNames)
      )
    );
  }

  acquireSessionExecution(reference: SessionReference) {
    return Promise.resolve().then(() =>
      this.#useDatabase('acquire execution', (db) =>
        acquireSqliteExecution(db, normalizeReference(reference), this.#tableNames)
      )
    );
  }

  releaseSessionExecution(lease: SessionExecutionLease): Promise<void> {
    return Promise.resolve().then(() =>
      this.#useDatabase('release execution', (db) =>
        releaseSqliteExecution(db, lease, this.#tableNames)
      )
    );
  }

  purgeSession(input: PurgeSessionInput): Promise<void> {
    return Promise.resolve().then(() =>
      this.#useDatabase('purge session', (db) => purgeSqliteSession(db, input, this.#tableNames))
    );
  }

  recoverSessionExecutions(input: RecoverSessionExecutionsInput) {
    return Promise.resolve().then(() =>
      this.#useDatabase('recover session', (db) =>
        recoverSqliteSession(db, input, this.#clock, this.#tableNames)
      )
    );
  }

  listSessionTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined> {
    return Promise.resolve().then(() =>
      this.#useDatabase('list session turns', (database) =>
        listSqliteSessionTurns(database, input, this.#tableNames)
      )
    );
  }

  renameSession(input: RenameSessionInput): Promise<SessionInspection> {
    return Promise.resolve().then(() =>
      this.#useDatabase('rename session', (database) =>
        runImmediateTransaction(database, () => {
          if (readSqliteLifecycle(database, input, this.#tableNames).fence.state === 'recovering') {
            throw new AgentSessionError('SESSION_BUSY', 'Session recovery is unsettled.');
          }
          return renameSqliteSession(database, input, this.#clock, this.#tableNames);
        })
      )
    );
  }

  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation> {
    return Promise.resolve().then(() =>
      this.#write(request, 'apply navigation', (database) =>
        applySqliteSessionNavigation(
          database,
          normalizeNavigationRequest(request),
          this.#createBranchId,
          this.#clock,
          this.#tableNames
        )
      )
    );
  }

  readCompaction(reference: SessionBranchReference): Promise<SessionCompaction | undefined> {
    return Promise.resolve().then(() => {
      const normalized = normalizeBranchReference(reference);
      return this.#useDatabase('read compaction', (database) =>
        readSqliteSessionCompaction(database, normalized, this.#tableNames)
      );
    });
  }

  commitCompaction(request: CommitSessionCompactionRequest): Promise<SessionCompaction> {
    return Promise.resolve().then(() => {
      const normalized = {
        ...normalizeBranchReference(request),
        expectedRevision: request.expectedRevision,
        throughTurnId: parseTurnId(request.throughTurnId),
        context: request.context,
      };
      return this.#write(request, 'commit compaction', (database) =>
        commitSqliteSessionCompaction(database, normalized, this.#clock, this.#tableNames)
      );
    });
  }

  #write<T>(
    request: SessionReference & SessionWriteAuthority,
    operation: string,
    action: (db: DatabaseSync) => T
  ): T {
    return this.#useDatabase(operation, (db) =>
      runImmediateTransaction(db, () => {
        assertSqliteSessionWrite(db, request, this.#tableNames);
        const result = action(db);
        advanceSqliteExecution(db, request, this.#tableNames);
        return result;
      })
    );
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useSqliteDatabase(this.#configuration, operation, (database) => {
      assertSessionSchema(database, this.#tableNames);
      configureDefensiveMode(database);
      return action(database);
    });
  }
}
