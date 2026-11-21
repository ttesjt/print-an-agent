import {
  AgentSessionError,
  completedLineageForBranch,
  type CommitSessionCompactionRequest,
  type SessionBranchReference,
  type SessionCompaction,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { requireString } from './codecs/columns.js';
import { decodeCompaction, requirePositiveInteger } from './codecs/compaction.js';
import { decodeContextMessage, encodeContextMessage } from './codecs/message.js';
import { readClock, runImmediateTransaction } from './database.js';
import { readCompactionRow } from './records.js';
import { loadSqliteSessionSnapshot } from './snapshot.js';
import { quoteSqliteIdentifier } from './table-names.js';
import type { SqliteSessionTableNames } from './types/table-names.js';

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
