import { randomUUID } from 'node:crypto';
import { parseAgentId } from '@ta-agent/base-identity';
import type { DatabaseSync } from 'node:sqlite';
import type { ModelMessage } from '@ta-agent/base-model';
import type {
  CommitSessionCompactionRequest,
  CompactableSessionPort,
  SessionCompaction,
  SessionContextSnapshot,
} from '../../compaction/contracts.js';
import { parseSessionBranchId, parseSessionId, parseTurnId } from '../../identifiers.js';
import type {
  AppliedSessionNavigation,
  ApplySessionNavigationRequest,
  NavigableSessionPort,
} from '../../navigation/contracts.js';
import type {
  ActiveSessionTurn,
  BeginSessionTurnRequest,
  CompleteSessionTurnRequest,
  CompletedSessionTurn,
  FailSessionTurnRequest,
  InspectableSessionPort,
  LoadSessionHistoryRequest,
  ResolveSessionRequest,
  ResolvedSessionReference,
  SessionBranchReference,
  SessionReference,
  SessionSnapshot,
  SessionTurn,
} from '../../types.js';
import {
  defineSqliteDatabaseConfiguration,
  useSqliteDatabase,
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
  resolveSqliteSession,
} from './session-navigation-storage.js';
import { normalizeReference } from './session-record-codec.js';
import {
  beginSqliteSessionTurn,
  completeSqliteSessionTurn,
  failSqliteSessionTurn,
  loadSqliteSessionHistory,
} from './session-turn-storage.js';
import { assertSessionSchema, configureDefensiveMode, initializeSessionSchema } from './schema.js';

export interface SqliteSessionAdapterOptions {
  readonly databasePath: string;
  readonly createSessionId?: () => string;
  readonly createBranchId?: () => string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}

function normalizeResolvedReference(request: BeginSessionTurnRequest): BeginSessionTurnRequest {
  return Object.freeze({
    agentId: parseAgentId(request.agentId),
    sessionId: parseSessionId(request.sessionId),
    branchId: parseSessionBranchId(request.branchId),
    navigationRevision: request.navigationRevision,
    turnId: parseTurnId(request.turnId),
    userMessage: request.userMessage,
  });
}

function normalizeBranchReference(reference: SessionBranchReference): SessionBranchReference {
  return Object.freeze({
    ...normalizeReference(reference),
    branchId: parseSessionBranchId(reference.branchId),
  });
}

function normalizeNavigationRequest(
  request: ApplySessionNavigationRequest
): ApplySessionNavigationRequest {
  const reference = normalizeReference(request);
  const command = request.command;
  if (command.operation === 'select') {
    return Object.freeze({
      ...reference,
      command: Object.freeze({
        ...command,
        branchId: parseSessionBranchId(command.branchId),
      }),
    });
  }
  if (command.operation === 'fork') {
    return Object.freeze({
      ...reference,
      command: Object.freeze({
        ...command,
        sourceBranchId: parseSessionBranchId(command.sourceBranchId),
        throughTurnId: parseTurnId(command.throughTurnId),
        ...(command.newBranchId === undefined
          ? {}
          : { newBranchId: parseSessionBranchId(command.newBranchId) }),
      }),
    });
  }
  return Object.freeze({
    ...reference,
    command: Object.freeze({
      ...command,
      throughTurnId: parseTurnId(command.throughTurnId),
      ...(command.newBranchId === undefined
        ? {}
        : { newBranchId: parseSessionBranchId(command.newBranchId) }),
    }),
  });
}

export class SqliteSessionAdapter
  implements InspectableSessionPort, CompactableSessionPort, NavigableSessionPort
{
  readonly #configuration: SqliteDatabaseConfiguration;
  readonly #createSessionId: () => string;
  readonly #createBranchId: () => string;
  readonly #clock: () => number;

  constructor(options: SqliteSessionAdapterOptions) {
    this.#configuration = defineSqliteDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#createBranchId = options.createBranchId ?? randomUUID;
    this.#clock = options.clock ?? Date.now;
    useSqliteDatabase(this.#configuration, 'initialize schema', (database) => {
      initializeSessionSchema(database);
      configureDefensiveMode(database);
    });
  }

  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference> {
    return Promise.resolve().then(() => {
      const reference = Object.freeze({
        agentId: parseAgentId(request.agentId),
        sessionId: parseSessionId(request.requestedSessionId ?? this.#createSessionId()),
      });
      return this.#useDatabase('resolve session', (database) =>
        resolveSqliteSession(database, reference, this.#clock)
      );
    });
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return Promise.resolve().then(() =>
      this.#useDatabase('begin turn', (database) =>
        beginSqliteSessionTurn(database, normalizeResolvedReference(request), this.#clock)
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
        loadSqliteSessionHistory(database, normalized)
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
        loadSqliteSessionContext(database, normalized)
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
      return this.#useDatabase('complete turn', (database) =>
        completeSqliteSessionTurn(database, normalized, this.#clock)
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
      return this.#useDatabase('fail turn', (database) =>
        failSqliteSessionTurn(database, normalized, this.#clock)
      );
    });
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const normalized = normalizeReference(reference);
      return this.#useDatabase('inspect session', (database) => {
        const found = database
          .prepare(
            'SELECT 1 AS found FROM ta_agent_base_sessions WHERE agent_id = ? AND session_id = ?'
          )
          .get(normalized.agentId, normalized.sessionId);
        return found === undefined ? undefined : loadSqliteSessionSnapshot(database, normalized);
      });
    });
  }

  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation> {
    return Promise.resolve().then(() =>
      this.#useDatabase('apply navigation', (database) =>
        applySqliteSessionNavigation(
          database,
          normalizeNavigationRequest(request),
          this.#createBranchId,
          this.#clock
        )
      )
    );
  }

  readCompaction(reference: SessionBranchReference): Promise<SessionCompaction | undefined> {
    return Promise.resolve().then(() => {
      const normalized = normalizeBranchReference(reference);
      return this.#useDatabase('read compaction', (database) =>
        readSqliteSessionCompaction(database, normalized)
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
      return this.#useDatabase('commit compaction', (database) =>
        commitSqliteSessionCompaction(database, normalized)
      );
    });
  }

  #useDatabase<T>(operation: string, action: (database: DatabaseSync) => T): T {
    return useSqliteDatabase(this.#configuration, operation, (database) => {
      assertSessionSchema(database);
      configureDefensiveMode(database);
      return action(database);
    });
  }
}
