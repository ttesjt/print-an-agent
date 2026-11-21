import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import type {
  PublishSessionMemoryNavigation,
  SessionExecutionFence,
  SessionLifecycleSnapshot,
  SessionMemoryRecord,
  SessionMemoryRecordKey,
  WriteSessionMemoryRecord,
} from '@print-an-agent/base-session';
import {
  AgentSessionError,
  defineSessionTurnPresentation,
  parseSessionId,
  parseTurnId,
  type ActiveSessionTurn,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type BeginSessionTurnRequest,
  type CommitSessionCompactionRequest,
  type CompactableSessionPort,
  type CompletedSessionTurn,
  type CompleteSessionTurnRequest,
  type CompleteSessionTurnWithPresentationRequest,
  type FailSessionTurnRequest,
  type InspectableSessionPort,
  type ListRetiredSessionsInput,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type LoadSessionHistoryRequest,
  type NavigableSessionPort,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type RenameSessionInput,
  type ResolvedSessionReference,
  type ResolveSessionRequest,
  type RetiredSessionListPage,
  type SessionBranchReference,
  type SessionCompaction,
  type SessionContextSnapshot,
  type SessionExecutionLease,
  type SessionInspection,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecycleMutationInput,
  type SessionMetadataPort,
  type SessionPresentationPort,
  type SessionQueryPort,
  type SessionReference,
  type SessionSnapshot,
  type SessionTurn,
  type SessionTurnPage,
  type SessionTurnPresentationRecord,
  type SessionTurnPresentationReference,
  type SessionWriteAuthority,
} from '@print-an-agent/base-session';
import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { commitSqliteSessionCompaction, readSqliteSessionCompaction } from './compaction.js';
import {
  configureDefensiveMode,
  defineSqliteDatabaseConfiguration,
  runImmediateTransaction,
  runReadTransaction,
  useSqliteDatabase,
} from './database.js';
import { loadSqliteSessionContext, loadSqliteSessionHistory } from './history.js';
import {
  normalizeBranchReference,
  normalizeNavigationRequest,
  normalizeReference,
  normalizeResolvedReference,
} from './input.js';
import {
  acquireSqliteExecution,
  assertSqliteSessionOpen,
  assertSqliteSessionWrite,
  releaseSqliteExecution,
} from './lifecycle/execution.js';
import { purgeSqliteSession, recoverSqliteSession } from './lifecycle/maintenance.js';
import { transitionSqliteSession } from './lifecycle/retirement.js';
import { advanceSqliteExecution, readSqliteLifecycle } from './lifecycle/state.js';
import { publishSqliteMemoryNavigation } from './memory-coordination/navigation.js';
import {
  listPendingSqliteMemoryRecords,
  readSqliteMemoryRecord,
  writeSqliteMemoryRecord,
} from './memory-coordination/records-operations.js';
import {
  pendingSessionMemoryRecords,
  sessionHasMemoryBindings,
} from './memory-coordination/records.js';
import { renameSqliteSession } from './metadata.js';
import { applySqliteSessionNavigation } from './navigation/apply.js';
import {
  inspectSqliteSession,
  listRetiredSqliteSessions,
  listSqliteSessions,
  listSqliteSessionTurns,
} from './query.js';
import { createSqliteSession, openSqliteSession } from './resolution.js';
import { initializeSessionSchema } from './schema/initialize.js';
import { assertSessionSchema } from './schema/validation.js';
import { loadSqliteSessionSnapshot } from './snapshot.js';
import { quoteSqliteIdentifier, resolveSqliteSessionTableNames } from './table-names.js';
import { readSqliteTurnPresentation } from './turns/presentation.js';
import {
  beginSqliteSessionTurn,
  completeSqliteSessionTurn,
  failSqliteSessionTurn,
} from './turns/storage.js';
import type { SqliteDatabaseConfiguration } from './types/database.js';
import type { SqliteSessionMemoryContext } from './types/memory-coordination.js';
import type { SqliteSessionAdapterOptions } from './types/options.js';
import type { SqliteSessionTableNames } from './types/table-names.js';

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
      this.#write(request, 'begin turn', (database) => {
        if (pendingSessionMemoryRecords(database, request, this.#tableNames).length !== 0)
          throw new AgentSessionError(
            'SESSION_MEMORY_PENDING',
            'Memory coordination is unsettled.'
          );
        return beginSqliteSessionTurn(
          database,
          normalizeResolvedReference(request),
          this.#clock,
          this.#tableNames
        );
      })
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

  retireSession(input: SessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot> {
    return Promise.resolve().then(() =>
      this.#useDatabase('retire session', (db) =>
        transitionSqliteSession(db, input, 'retire', this.#clock, this.#tableNames)
      )
    );
  }

  restoreSession(input: SessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot> {
    return Promise.resolve().then(() =>
      this.#useDatabase('restore session', (db) =>
        transitionSqliteSession(db, input, 'restore', this.#clock, this.#tableNames)
      )
    );
  }

  acquireSessionExecution(reference: SessionReference): Promise<SessionExecutionLease> {
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

  recoverSessionExecutions(input: RecoverSessionExecutionsInput): Promise<SessionExecutionFence> {
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
      this.#write(request, 'apply navigation', (database) => {
        if (sessionHasMemoryBindings(database, request, this.#tableNames))
          throw new AgentSessionError(
            'SESSION_MEMORY_NOT_CONFIGURED',
            'Use the Memory-aware navigation coordinator for this Session.'
          );
        return applySqliteSessionNavigation(
          database,
          normalizeNavigationRequest(request),
          this.#createBranchId,
          this.#clock,
          this.#tableNames
        );
      })
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

  readMemoryRecord(key: SessionMemoryRecordKey): Promise<SessionMemoryRecord | undefined> {
    return readSqliteMemoryRecord(this.#memoryContext(), key);
  }

  listPendingMemoryRecords(ref: SessionReference): Promise<readonly SessionMemoryRecord[]> {
    return listPendingSqliteMemoryRecords(this.#memoryContext(), ref);
  }

  writeMemoryRecord(input: WriteSessionMemoryRecord): Promise<SessionMemoryRecord> {
    return writeSqliteMemoryRecord(this.#memoryContext(), input);
  }

  publishMemoryNavigation(
    input: PublishSessionMemoryNavigation
  ): Promise<AppliedSessionNavigation> {
    return publishSqliteMemoryNavigation(this.#memoryContext(), input);
  }

  #memoryContext(): SqliteSessionMemoryContext {
    return {
      tableNames: this.#tableNames,
      clock: this.#clock,
      createBranchId: this.#createBranchId,
      useDatabase: <T>(operation: string, action: (database: DatabaseSync) => T): T =>
        this.#useDatabase(operation, action),
    };
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
