import {
  completedLineageForBranch,
  type SessionBranchId,
  type SessionSnapshot,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { requireNonNegativeInteger, requireString } from '../codecs/columns.js';
import { quoteSqliteIdentifier } from '../table-names.js';
import type { SqliteRow } from '../types/record.js';
import type { SqliteSessionTableNames } from '../types/table-names.js';

export function inheritCompaction(
  database: DatabaseSync,
  snapshot: SessionSnapshot,
  sourceBranchId: SessionBranchId,
  targetBranchId: SessionBranchId,
  throughTurnId: string,
  tableNames: SqliteSessionTableNames
): void {
  const row = database
    .prepare(
      `SELECT revision, through_turn_id, context_message, created_at
       FROM ${quoteSqliteIdentifier(tableNames.compactions)}
       WHERE agent_id = ? AND session_id = ? AND branch_id = ?`
    )
    .get(snapshot.agentId, snapshot.sessionId, sourceBranchId) as SqliteRow | undefined;
  if (row === undefined) return;
  const lineage = completedLineageForBranch(snapshot, sourceBranchId);
  const boundaryIndex = lineage.findIndex(
    (turn) => turn.turnId === requireString(row, 'through_turn_id')
  );
  const forkIndex = lineage.findIndex((turn) => turn.turnId === throughTurnId);
  if (boundaryIndex < 0 || forkIndex < boundaryIndex) return;
  database
    .prepare(
      `INSERT INTO ${quoteSqliteIdentifier(tableNames.compactions)}
        (agent_id, session_id, branch_id, revision, through_turn_id, context_message, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    )
    .run(
      snapshot.agentId,
      snapshot.sessionId,
      targetBranchId,
      requireString(row, 'through_turn_id'),
      requireString(row, 'context_message'),
      requireNonNegativeInteger(row, 'created_at')
    );
}
