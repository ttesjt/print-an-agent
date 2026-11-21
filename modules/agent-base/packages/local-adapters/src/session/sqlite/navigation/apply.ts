import {
  AgentSessionError,
  isCompletedAncestor,
  parseSessionBranchId,
  toSessionNavigationSnapshot,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type SessionBranchId,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { readClock, runImmediateTransaction } from '../database.js';
import { loadSqliteSessionSnapshot } from '../snapshot.js';
import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';
import { inheritCompaction } from './inherit-compaction.js';

export function applySqliteSessionNavigation(
  database: DatabaseSync,
  request: ApplySessionNavigationRequest,
  createBranchId: () => string,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): AppliedSessionNavigation {
  return runImmediateTransaction(database, () => {
    const timestamp = readClock(clock);
    const snapshot = loadSqliteSessionSnapshot(database, request, tableNames);
    if (request.command.expectedRevision !== snapshot.navigation.revision) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        `Session navigation expected revision ${request.command.expectedRevision} but found ${snapshot.navigation.revision}.`
      );
    }
    let affectedBranchId: SessionBranchId;
    let selectedBranchId = snapshot.navigation.selectedBranchId;
    if (request.command.operation === 'select') {
      const branchId = request.command.branchId;
      if (!snapshot.navigation.branches.some((branch) => branch.branchId === branchId)) {
        throw new AgentSessionError(
          'SESSION_BRANCH_NOT_FOUND',
          `Session branch "${branchId}" does not exist.`
        );
      }
      affectedBranchId = branchId;
      selectedBranchId = affectedBranchId;
    } else {
      const sourceBranchId =
        request.command.operation === 'fork'
          ? request.command.sourceBranchId
          : snapshot.navigation.selectedBranchId;
      if (!isCompletedAncestor(snapshot, sourceBranchId, request.command.throughTurnId)) {
        throw new AgentSessionError(
          'SESSION_NAVIGATION_TARGET_INVALID',
          'Session navigation target must be a completed ancestor of the source branch.'
        );
      }
      affectedBranchId = parseSessionBranchId(request.command.newBranchId ?? createBranchId());
      if (snapshot.navigation.branches.some((branch) => branch.branchId === affectedBranchId)) {
        throw new AgentSessionError(
          'SESSION_BRANCH_ALREADY_EXISTS',
          `Session branch "${affectedBranchId}" already exists.`
        );
      }
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.branches)}
            (agent_id, session_id, branch_id, parent_branch_id, forked_from_turn_id, head_turn_id,
             created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          request.agentId,
          request.sessionId,
          affectedBranchId,
          sourceBranchId,
          request.command.throughTurnId,
          request.command.throughTurnId,
          timestamp
        );
      inheritCompaction(
        database,
        snapshot,
        sourceBranchId,
        affectedBranchId,
        request.command.throughTurnId,
        tableNames
      );
      if (request.command.operation === 'rewind') selectedBranchId = affectedBranchId;
    }
    const update = database
      .prepare(
        `UPDATE ${quoteSqliteIdentifier(tableNames.sessions)}
         SET selected_branch_id = ?, navigation_revision = navigation_revision + 1,
             updated_at = MAX(updated_at, ?)
         WHERE agent_id = ? AND session_id = ? AND navigation_revision = ?`
      )
      .run(
        selectedBranchId,
        timestamp,
        request.agentId,
        request.sessionId,
        request.command.expectedRevision
      );
    if (update.changes !== 1) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        'Session navigation revision changed before commit.'
      );
    }
    const navigation = toSessionNavigationSnapshot(
      loadSqliteSessionSnapshot(database, request, tableNames)
    );
    return Object.freeze({
      operation: request.command.operation,
      affectedBranchId,
      navigation,
    });
  });
}
