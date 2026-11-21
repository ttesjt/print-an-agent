import {
  AgentSessionError,
  completedLineageForBranch,
  isCompletedAncestor,
  type SessionBranchId,
  type SessionReference,
  type SessionSnapshot,
} from '@print-an-agent/base-session';
import type { DatabaseSync } from 'node:sqlite';
import { decodeBranch } from './codecs/branch.js';
import { requireNonNegativeInteger, requireString } from './codecs/columns.js';
import { normalizePersistedBranchId, normalizePersistedTurnId } from './codecs/identifiers.js';
import { decodeTurn } from './codecs/turn.js';
import { requireSession } from './records.js';
import { quoteSqliteIdentifier } from './table-names.js';
import type { SqliteRow } from './types/record.js';
import type { SqliteSessionTableNames } from './types/table-names.js';

const TURN_COLUMNS =
  'turn_id, status, user_message, assistant_message, failure_code, branch_id, parent_turn_id';

function assertBranchParentLineage(snapshot: SessionSnapshot): void {
  const branches = new Map(
    snapshot.navigation.branches.map((branch) => [branch.branchId, branch] as const)
  );
  if (!branches.has(snapshot.navigation.selectedBranchId)) {
    throw new AgentSessionError(
      'SESSION_RECORD_INVALID',
      'SQLite Session selected branch does not exist.'
    );
  }
  for (const branch of branches.values()) {
    const visited = new Set<SessionBranchId>();
    let current = branch;
    while (current.parentBranchId !== undefined) {
      if (visited.has(current.branchId)) {
        throw new AgentSessionError(
          'SESSION_RECORD_INVALID',
          'SQLite Session branch lineage contains a cycle.'
        );
      }
      visited.add(current.branchId);
      const parent = branches.get(current.parentBranchId);
      if (parent === undefined || current.forkedFromTurnId === undefined) {
        throw new AgentSessionError(
          'SESSION_RECORD_INVALID',
          'SQLite Session branch parent or fork authority is invalid.'
        );
      }
      if (!isCompletedAncestor(snapshot, parent.branchId, current.forkedFromTurnId)) {
        throw new AgentSessionError(
          'SESSION_RECORD_INVALID',
          'SQLite Session fork turn is not an ancestor of its parent branch.'
        );
      }
      current = parent;
    }
    if (current.forkedFromTurnId !== undefined) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session root branch cannot contain fork authority.'
      );
    }
    const lineage = completedLineageForBranch(snapshot, branch.branchId);
    const forkIndex =
      branch.forkedFromTurnId === undefined
        ? -1
        : lineage.findIndex((turn) => turn.turnId === branch.forkedFromTurnId);
    if (branch.parentBranchId !== undefined && forkIndex < 0) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session branch head does not descend from its fork authority.'
      );
    }
    if (lineage.slice(forkIndex + 1).some((turn) => turn.branchId !== branch.branchId)) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session branch lineage crosses an unrelated branch.'
      );
    }
  }
}

function assertTurnLineage(snapshot: SessionSnapshot): void {
  const branches = new Map(
    snapshot.navigation.branches.map((branch) => [branch.branchId, branch] as const)
  );
  const turns = new Map(snapshot.turns.map((turn) => [turn.turnId, turn] as const));
  for (const turn of snapshot.turns) {
    const branch = branches.get(turn.branchId);
    if (branch === undefined) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session turn belongs to a missing branch.'
      );
    }
    if (turn.parentTurnId !== undefined) {
      const parent = turns.get(turn.parentTurnId);
      if (parent?.status !== 'completed') {
        throw new AgentSessionError(
          'SESSION_RECORD_INVALID',
          'SQLite Session turn parent must be a completed turn in the same Session.'
        );
      }
      if (
        !isCompletedAncestor(snapshot, turn.branchId, turn.parentTurnId) ||
        (parent.branchId !== turn.branchId && branch.forkedFromTurnId !== turn.parentTurnId)
      ) {
        throw new AgentSessionError(
          'SESSION_RECORD_INVALID',
          'SQLite Session turn parent is outside its branch lineage.'
        );
      }
    } else if (branch.parentBranchId !== undefined) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session child-branch turn is missing parent authority.'
      );
    }
    if (turn.status === 'completed' && !isCompletedAncestor(snapshot, turn.branchId, turn.turnId)) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session completed turn is not an ancestor of its branch head.'
      );
    }
  }
}

function assertCompactionLineage(
  database: DatabaseSync,
  snapshot: SessionSnapshot,
  tableNames: SqliteSessionTableNames
): void {
  const rows = database
    .prepare(
      `SELECT branch_id, through_turn_id
       FROM ${quoteSqliteIdentifier(tableNames.compactions)}
       WHERE agent_id = ? AND session_id = ?`
    )
    .all(snapshot.agentId, snapshot.sessionId) as SqliteRow[];
  for (const row of rows) {
    const branchId = normalizePersistedBranchId(
      requireString(row, 'branch_id'),
      'SQLite Session compaction branch ID'
    );
    const throughTurnId = normalizePersistedTurnId(
      requireString(row, 'through_turn_id'),
      'SQLite Session compaction turn ID'
    );
    if (!isCompletedAncestor(snapshot, branchId, throughTurnId)) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'SQLite Session compaction boundary is outside its branch lineage.'
      );
    }
  }
}

export function loadSqliteSessionSnapshot(
  database: DatabaseSync,
  reference: SessionReference,
  tableNames: SqliteSessionTableNames
): SessionSnapshot {
  const session = requireSession(database, reference, tableNames);
  const branches = database
    .prepare(
      `SELECT branch_id, parent_branch_id, forked_from_turn_id, head_turn_id, created_at
       FROM ${quoteSqliteIdentifier(tableNames.branches)}
       WHERE agent_id = ? AND session_id = ?
       ORDER BY rowid ASC`
    )
    .all(reference.agentId, reference.sessionId) as SqliteRow[];
  const turns = database
    .prepare(
      `SELECT ${TURN_COLUMNS}
       FROM ${quoteSqliteIdentifier(tableNames.turns)}
       WHERE agent_id = ? AND session_id = ?
       ORDER BY turn_sequence ASC`
    )
    .all(reference.agentId, reference.sessionId) as SqliteRow[];
  const snapshot: SessionSnapshot = Object.freeze({
    ...reference,
    navigation: Object.freeze({
      ...reference,
      revision: requireNonNegativeInteger(session, 'navigation_revision'),
      selectedBranchId: normalizePersistedBranchId(
        requireString(session, 'selected_branch_id'),
        'SQLite Session selected branch ID'
      ),
      branches: Object.freeze(branches.map(decodeBranch)),
    }),
    turns: Object.freeze(turns.map(decodeTurn)),
  });
  assertBranchParentLineage(snapshot);
  assertTurnLineage(snapshot);
  assertCompactionLineage(database, snapshot, tableNames);
  return snapshot;
}
