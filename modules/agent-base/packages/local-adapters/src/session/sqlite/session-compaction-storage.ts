import {
  AgentSessionError,
  completedLineageBeforeTurn,
  completedLineageForBranch,
  type CommitSessionCompactionRequest,
  type LoadSessionHistoryRequest,
  type SessionBranchReference,
  type SessionCompaction,
  type SessionContextSnapshot,
  type SessionTurn,
} from '@print-an-agent/base-session';
import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import type { DatabaseSync } from 'node:sqlite';
import { readClock, runImmediateTransaction } from './database.js';
import { decodeContextMessage, encodeContextMessage } from './message-codec.js';
import { loadSqliteSessionSnapshot } from './session-navigation-storage.js';
import {
  normalizePersistedTurnId,
  requireNonNegativeInteger,
  requireString,
  type SqliteRow,
} from './session-record-codec.js';
import type { SqliteSessionTableNames } from './table-names.js';
import { quoteSqliteIdentifier } from './table-names.js';

function requirePositiveInteger(row: SqliteRow, column: string): number {
  const value = requireNonNegativeInteger(row, column, 'SQLite Session compaction');
  if (value === 0) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      `SQLite Session compaction column "${column}" must be positive.`
    );
  }
  return value;
}

function decodeCompaction(reference: SessionBranchReference, row: SqliteRow): SessionCompaction {
  return Object.freeze({
    ...reference,
    revision: requirePositiveInteger(row, 'revision'),
    throughTurnId: normalizePersistedTurnId(
      requireString(row, 'through_turn_id'),
      'SQLite Session compaction turn ID'
    ),
    context: decodeContextMessage(requireString(row, 'context_message')),
  });
}

function readCompactionRow(
  database: DatabaseSync,
  reference: SessionBranchReference,
  tableNames: SqliteSessionTableNames
): SqliteRow | undefined {
  return database
    .prepare(
      `SELECT revision, through_turn_id, context_message, created_at
       FROM ${quoteSqliteIdentifier(tableNames.compactions)}
       WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
    )
    .get(reference.agentId, reference.sessionId, reference.branchId) as SqliteRow | undefined;
}

function findTurn(
  turns: readonly SessionTurn[],
  turnId: LoadSessionHistoryRequest['beforeTurnId']
): SessionTurn {
  const turn = turns.find((candidate) => candidate.turnId === turnId);
  if (turn === undefined) {
    throw new AgentSessionError('TURN_NOT_FOUND', `Turn "${turnId}" does not exist.`);
  }
  return turn;
}

export function loadSqliteSessionContext(
  database: DatabaseSync,
  request: LoadSessionHistoryRequest,
  tableNames: SqliteSessionTableNames
): SessionContextSnapshot {
  const snapshot = loadSqliteSessionSnapshot(database, request, tableNames);
  const beforeTurn = findTurn(snapshot.turns, request.beforeTurnId);
  const reference = { ...request, branchId: beforeTurn.branchId } as const;
  const lineage = completedLineageBeforeTurn(snapshot, request.beforeTurnId);
  const row = readCompactionRow(database, reference, tableNames);
  const compaction = row === undefined ? undefined : decodeCompaction(reference, row);
  const boundaryIndex =
    compaction === undefined
      ? -1
      : lineage.findIndex((turn) => turn.turnId === compaction.throughTurnId);
  const useCompaction = compaction !== undefined && boundaryIndex >= 0;
  const messages = lineage
    .slice(useCompaction ? boundaryIndex + 1 : 0)
    .flatMap<ModelMessage>((turn) => [turn.userMessage, turn.assistantMessage]);
  return Object.freeze({
    ...reference,
    ...(useCompaction ? { compaction } : {}),
    messages: Object.freeze([...(useCompaction ? [compaction.context] : []), ...messages]),
  });
}

export function readSqliteSessionCompaction(
  database: DatabaseSync,
  reference: SessionBranchReference,
  tableNames: SqliteSessionTableNames
): SessionCompaction | undefined {
  const snapshot = loadSqliteSessionSnapshot(database, reference, tableNames);
  if (!snapshot.navigation.branches.some((branch) => branch.branchId === reference.branchId)) {
    throw new AgentSessionError(
      'SESSION_BRANCH_NOT_FOUND',
      `Session branch "${reference.branchId}" does not exist.`
    );
  }
  const row = readCompactionRow(database, reference, tableNames);
  return row === undefined ? undefined : decodeCompaction(reference, row);
}

function assertExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction expected revision must be a non-negative safe integer.'
    );
  }
}

export function commitSqliteSessionCompaction(
  database: DatabaseSync,
  request: CommitSessionCompactionRequest,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): SessionCompaction {
  assertExpectedRevision(request.expectedRevision);
  const contextMessage = encodeContextMessage(request.context);
  return runImmediateTransaction(database, () => {
    const snapshot = loadSqliteSessionSnapshot(database, request, tableNames);
    const lineage = completedLineageForBranch(snapshot, request.branchId);
    const throughIndex = lineage.findIndex((turn) => turn.turnId === request.throughTurnId);
    if (throughIndex < 0) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_INVALID',
        'Session compaction boundary must be a completed ancestor of its branch head.'
      );
    }
    const currentRow = readCompactionRow(database, request, tableNames);
    const currentRevision =
      currentRow === undefined ? 0 : requirePositiveInteger(currentRow, 'revision');
    if (request.expectedRevision !== currentRevision) {
      throw new AgentSessionError(
        'SESSION_COMPACTION_CONFLICT',
        `Session compaction expected revision ${request.expectedRevision} but found ${currentRevision}.`
      );
    }
    if (currentRow !== undefined) {
      const previousIndex = lineage.findIndex(
        (turn) => turn.turnId === requireString(currentRow, 'through_turn_id')
      );
      if (previousIndex < 0 || throughIndex <= previousIndex) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_CONFLICT',
          'Session compaction boundary must advance the current branch projection.'
        );
      }
    }
    const revision = currentRevision + 1;
    const committedAt = readClock(clock);
    if (currentRow === undefined) {
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.compactions)}
            (agent_id, session_id, branch_id, revision, through_turn_id, context_message, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          request.agentId,
          request.sessionId,
          request.branchId,
          revision,
          request.throughTurnId,
          contextMessage,
          request.context.timestamp
        );
    } else {
      const update = database
        .prepare(
          `UPDATE ${quoteSqliteIdentifier(tableNames.compactions)}
           SET revision = ?, through_turn_id = ?, context_message = ?, created_at = ?
           WHERE agent_id = ? AND session_id = ? AND branch_id = ? AND revision = ?`
        )
        .run(
          revision,
          request.throughTurnId,
          contextMessage,
          request.context.timestamp,
          request.agentId,
          request.sessionId,
          request.branchId,
          request.expectedRevision
        );
      if (update.changes !== 1) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_CONFLICT',
          'Session compaction revision changed before commit.'
        );
      }
    }
    database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
         SET updated_at = MAX(updated_at, ?)
         WHERE agent_id = ? AND session_id = ?`
      )
      .run(committedAt, request.agentId, request.sessionId);
    return Object.freeze({
      agentId: request.agentId,
      sessionId: request.sessionId,
      branchId: request.branchId,
      revision,
      throughTurnId: request.throughTurnId,
      context: decodeContextMessage(contextMessage),
    });
  });
}
