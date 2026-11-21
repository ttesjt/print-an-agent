import {
  AgentSessionError,
  completedLineageBeforeTurn,
  type LoadSessionHistoryRequest,
  type SessionContextSnapshot,
  type SessionTurn,
} from '@print-an-agent/base-session';
import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import type { DatabaseSync } from 'node:sqlite';
import { decodeCompaction } from './codecs/compaction.js';
import { readCompactionRow } from './records.js';
import { loadSqliteSessionSnapshot } from './snapshot.js';
import type { SqliteSessionTableNames } from './types/table-names.js';

export function loadSqliteSessionHistory(
  database: DatabaseSync,
  request: LoadSessionHistoryRequest,
  tableNames: SqliteSessionTableNames
): readonly ModelMessage[] {
  const lineage = completedLineageBeforeTurn(
    loadSqliteSessionSnapshot(database, request, tableNames),
    request.beforeTurnId
  );
  return Object.freeze(
    lineage.flatMap<ModelMessage>((turn) => [turn.userMessage, turn.assistantMessage])
  );
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
