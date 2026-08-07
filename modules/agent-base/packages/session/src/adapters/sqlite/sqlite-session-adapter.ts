import { randomUUID } from 'node:crypto';
import { parseAgentId } from '@ta-agent/base-identity';
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import type { ModelMessage } from '@ta-agent/base-model';
import { AgentSessionError } from '../../errors.js';
import { parseSessionFailureCode, parseSessionId, parseTurnId } from '../../identifiers.js';
import type {
  ActiveSessionTurn,
  BeginSessionTurnRequest,
  CompleteSessionTurnRequest,
  CompletedSessionTurn,
  FailSessionTurnRequest,
  FailedSessionTurn,
  InspectableSessionPort,
  LoadSessionHistoryRequest,
  ResolveSessionRequest,
  SessionReference,
  SessionSnapshot,
  SessionTurn,
  TurnId,
} from '../../types.js';
import {
  defineSqliteDatabaseConfiguration,
  readClock,
  runImmediateTransaction,
  useSqliteDatabase,
  type SqliteDatabaseConfiguration,
} from './database.js';
import {
  decodeAssistantMessage,
  decodeUserMessage,
  encodeAssistantMessage,
  encodeUserMessage,
} from './message-codec.js';
import { assertSessionSchema, configureDefensiveMode, initializeSessionSchema } from './schema.js';

export interface SqliteSessionAdapterOptions {
  readonly databasePath: string;
  readonly createSessionId?: () => string;
  readonly clock?: () => number;
  readonly busyTimeoutMilliseconds?: number;
}

type SqliteRow = Record<string, SQLOutputValue>;

function requireString(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `SQLite Session column "${column}" must be a string.`
    );
  }
  return value;
}

function normalizePersistedTurnId(row: SqliteRow): TurnId {
  try {
    return parseTurnId(requireString(row, 'turn_id'));
  } catch (cause: unknown) {
    if (cause instanceof AgentSessionError && cause.code === 'SESSION_RECORD_INVALID') throw cause;
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      'SQLite Session record contains an invalid turn ID.',
      { cause }
    );
  }
}

function decodeTurn(row: SqliteRow): SessionTurn {
  const turnId = normalizePersistedTurnId(row);
  const status = requireString(row, 'status');
  const userMessage = decodeUserMessage(requireString(row, 'user_message'));

  if (status === 'active') {
    return Object.freeze({ status, turnId, userMessage });
  }
  if (status === 'completed') {
    return Object.freeze({
      status,
      turnId,
      userMessage,
      assistantMessage: decodeAssistantMessage(requireString(row, 'assistant_message')),
    });
  }
  if (status === 'failed') {
    let failureCode: string;
    try {
      failureCode = parseSessionFailureCode(requireString(row, 'failure_code'));
    } catch (cause: unknown) {
      if (cause instanceof AgentSessionError && cause.code === 'SESSION_RECORD_INVALID')
        throw cause;
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session record contains an invalid failure code.',
        { cause }
      );
    }
    return Object.freeze({ status, turnId, userMessage, failureCode });
  }
  throw new AgentSessionError(
    'SESSION_RECORD_INVALID',
    `SQLite Session record contains unsupported turn status "${status}".`
  );
}

function requireSession(database: DatabaseSync, reference: SessionReference): void {
  const row = database
    .prepare('SELECT 1 AS found FROM ta_agent_base_sessions WHERE agent_id = ? AND session_id = ?')
    .get(reference.agentId, reference.sessionId);
  if (row === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
    );
  }
}

function requireTurnRow(
  database: DatabaseSync,
  reference: SessionReference,
  turnId: TurnId
): SqliteRow {
  const row = database
    .prepare(
      `SELECT turn_id, status, user_message, assistant_message, failure_code
       FROM ta_agent_base_session_turns
       WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
    )
    .get(reference.agentId, reference.sessionId, turnId) as SqliteRow | undefined;
  if (row === undefined) {
    throw new AgentSessionError(
      'TURN_NOT_FOUND',
      `Turn "${turnId}" does not exist in session "${reference.sessionId}".`
    );
  }
  return row;
}

function normalizeReference(reference: SessionReference): SessionReference {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
  });
}

export class SqliteSessionAdapter implements InspectableSessionPort {
  readonly #configuration: SqliteDatabaseConfiguration;
  readonly #createSessionId: () => string;
  readonly #clock: () => number;

  constructor(options: SqliteSessionAdapterOptions) {
    this.#configuration = defineSqliteDatabaseConfiguration(
      options.databasePath,
      options.busyTimeoutMilliseconds
    );
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#clock = options.clock ?? Date.now;

    useSqliteDatabase(this.#configuration, 'initialize schema', (database) => {
      initializeSessionSchema(database);
      configureDefensiveMode(database);
    });
  }

  resolve(request: ResolveSessionRequest): Promise<SessionReference> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(request.agentId);
      const sessionId = parseSessionId(request.requestedSessionId ?? this.#createSessionId());
      const createdAt = readClock(this.#clock);
      this.#useDatabase('resolve session', (database) => {
        runImmediateTransaction(database, () => {
          database
            .prepare(
              `INSERT OR IGNORE INTO ta_agent_base_sessions
                (agent_id, session_id, next_turn_sequence, created_at)
               VALUES (?, ?, 0, ?)`
            )
            .run(agentId, sessionId, createdAt);
        });
      });
      return Object.freeze({ agentId, sessionId });
    });
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const turnId = parseTurnId(request.turnId);
      const userMessageJson = encodeUserMessage(request.userMessage);
      const userMessage = decodeUserMessage(userMessageJson);
      const startedAt = readClock(this.#clock);

      this.#useDatabase('begin turn', (database) => {
        runImmediateTransaction(database, () => {
          requireSession(database, reference);
          const duplicate = database
            .prepare(
              `SELECT 1 AS found FROM ta_agent_base_session_turns
               WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
            )
            .get(reference.agentId, reference.sessionId, turnId);
          if (duplicate !== undefined) {
            throw new AgentSessionError(
              'TURN_ALREADY_EXISTS',
              `Turn "${turnId}" already exists in session "${reference.sessionId}".`
            );
          }

          const sessionRow = database
            .prepare(
              `SELECT next_turn_sequence
               FROM ta_agent_base_sessions
               WHERE agent_id = ? AND session_id = ?`
            )
            .get(reference.agentId, reference.sessionId) as SqliteRow | undefined;
          const sequence = sessionRow?.next_turn_sequence;
          if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
            throw new AgentSessionError(
              'SESSION_RECORD_INVALID',
              'SQLite Session contains an invalid next turn sequence.'
            );
          }

          database
            .prepare(
              `INSERT INTO ta_agent_base_session_turns
                (agent_id, session_id, turn_id, turn_sequence, status, user_message, started_at)
               VALUES (?, ?, ?, ?, 'active', ?, ?)`
            )
            .run(
              reference.agentId,
              reference.sessionId,
              turnId,
              sequence,
              userMessageJson,
              startedAt
            );
          database
            .prepare(
              `UPDATE ta_agent_base_sessions
               SET next_turn_sequence = ?
               WHERE agent_id = ? AND session_id = ?`
            )
            .run(sequence + 1, reference.agentId, reference.sessionId);
        });
      });

      return Object.freeze({ status: 'active', turnId, userMessage });
    });
  }

  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const beforeTurnId = parseTurnId(request.beforeTurnId);
      return this.#useDatabase('load history', (database) => {
        requireSession(database, reference);
        const boundary = database
          .prepare(
            `SELECT turn_sequence
             FROM ta_agent_base_session_turns
             WHERE agent_id = ? AND session_id = ? AND turn_id = ?`
          )
          .get(reference.agentId, reference.sessionId, beforeTurnId) as SqliteRow | undefined;
        if (boundary === undefined) {
          throw new AgentSessionError(
            'TURN_NOT_FOUND',
            `Turn "${beforeTurnId}" does not exist in session "${reference.sessionId}".`
          );
        }
        const sequence = boundary.turn_sequence;
        if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
          throw new AgentSessionError(
            'SESSION_RECORD_INVALID',
            'SQLite Session history boundary has an invalid turn sequence.'
          );
        }

        const rows = database
          .prepare(
            `SELECT turn_id, status, user_message, assistant_message, failure_code
             FROM ta_agent_base_session_turns
             WHERE agent_id = ? AND session_id = ?
               AND turn_sequence < ? AND status = 'completed'
             ORDER BY turn_sequence ASC`
          )
          .all(reference.agentId, reference.sessionId, sequence) as SqliteRow[];
        const messages = rows.flatMap<ModelMessage>((row) => {
          const turn = decodeTurn(row);
          if (turn.status !== 'completed') {
            throw new AgentSessionError(
              'SESSION_RECORD_INVALID',
              'SQLite Session completed history query returned a non-completed turn.'
            );
          }
          return [turn.userMessage, turn.assistantMessage];
        });
        return Object.freeze(messages);
      });
    });
  }

  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const turnId = parseTurnId(request.turnId);
      const assistantMessageJson = encodeAssistantMessage(request.assistantMessage);
      const assistantMessage = decodeAssistantMessage(assistantMessageJson);
      const finishedAt = readClock(this.#clock);

      return this.#useDatabase('complete turn', (database) =>
        runImmediateTransaction(database, () => {
          requireSession(database, reference);
          const current = decodeTurn(requireTurnRow(database, reference, turnId));
          if (current.status !== 'active') {
            throw new AgentSessionError(
              'TURN_STATE_INVALID',
              `Turn "${turnId}" cannot complete from state "${current.status}".`
            );
          }
          const result = database
            .prepare(
              `UPDATE ta_agent_base_session_turns
               SET status = 'completed', assistant_message = ?, finished_at = ?
               WHERE agent_id = ? AND session_id = ? AND turn_id = ? AND status = 'active'`
            )
            .run(assistantMessageJson, finishedAt, reference.agentId, reference.sessionId, turnId);
          if (result.changes !== 1) {
            throw new AgentSessionError(
              'TURN_STATE_INVALID',
              `Turn "${turnId}" was not active when completion was committed.`
            );
          }
          return Object.freeze({
            status: 'completed',
            turnId,
            userMessage: current.userMessage,
            assistantMessage,
          });
        })
      );
    });
  }

  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(request);
      const turnId = parseTurnId(request.turnId);
      const failureCode = parseSessionFailureCode(request.failureCode);
      const finishedAt = readClock(this.#clock);

      return this.#useDatabase('fail turn', (database) =>
        runImmediateTransaction(database, () => {
          requireSession(database, reference);
          const current = decodeTurn(requireTurnRow(database, reference, turnId));
          if (current.status !== 'active') return current;

          const result = database
            .prepare(
              `UPDATE ta_agent_base_session_turns
               SET status = 'failed', failure_code = ?, finished_at = ?
               WHERE agent_id = ? AND session_id = ? AND turn_id = ? AND status = 'active'`
            )
            .run(failureCode, finishedAt, reference.agentId, reference.sessionId, turnId);
          if (result.changes !== 1) {
            throw new AgentSessionError(
              'TURN_STATE_INVALID',
              `Turn "${turnId}" was not active when failure was committed.`
            );
          }
          const failed: FailedSessionTurn = Object.freeze({
            status: 'failed',
            turnId,
            userMessage: current.userMessage,
            failureCode,
          });
          return failed;
        })
      );
    });
  }

  inspect(referenceInput: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const reference = normalizeReference(referenceInput);
      return this.#useDatabase('inspect session', (database) => {
        const session = database
          .prepare(
            'SELECT 1 AS found FROM ta_agent_base_sessions WHERE agent_id = ? AND session_id = ?'
          )
          .get(reference.agentId, reference.sessionId);
        if (session === undefined) return undefined;
        const rows = database
          .prepare(
            `SELECT turn_id, status, user_message, assistant_message, failure_code
             FROM ta_agent_base_session_turns
             WHERE agent_id = ? AND session_id = ?
             ORDER BY turn_sequence ASC`
          )
          .all(reference.agentId, reference.sessionId) as SqliteRow[];
        return Object.freeze({
          ...reference,
          turns: Object.freeze(rows.map(decodeTurn)),
        });
      });
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
