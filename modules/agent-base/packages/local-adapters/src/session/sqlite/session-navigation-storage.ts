import type { DatabaseSync } from 'node:sqlite';
import { quoteSqliteIdentifier } from './table-names.js';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  completedLineageForBranch,
  isCompletedAncestor,
  parseSessionBranchId,
  toSessionNavigationSnapshot,
  type ResolvedSessionReference,
  type SessionBranchId,
  type SessionReference,
  type SessionSnapshot,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
} from '@ta-agent/base-session';
import { readClock, runImmediateTransaction } from './database.js';
import {
  decodeBranch,
  decodeTurn,
  normalizePersistedBranchId,
  normalizePersistedTurnId,
  requireNonNegativeInteger,
  requireSession,
  requireString,
  type SqliteRow,
} from './session-record-codec.js';
import type { SqliteSessionTableNames } from './table-names.js';

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

export function resolveSqliteSession(
  database: DatabaseSync,
  reference: SessionReference,
  clock: () => number,
  tableNames: SqliteSessionTableNames
): ResolvedSessionReference {
  runImmediateTransaction(database, () => {
    const createdAt = readClock(clock);
    const inserted = database
      .prepare(
        `INSERT OR IGNORE INTO ${quoteSqliteIdentifier(tableNames.sessions)}
          (agent_id, session_id, next_turn_sequence, created_at, selected_branch_id,
           navigation_revision, updated_at)
         VALUES (?, ?, 0, ?, ?, 0, ?)`
      )
      .run(reference.agentId, reference.sessionId, createdAt, DEFAULT_SESSION_BRANCH_ID, createdAt);
    if (inserted.changes === 1) {
      database
        .prepare(
          `INSERT INTO ${quoteSqliteIdentifier(tableNames.branches)}
            (agent_id, session_id, branch_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(reference.agentId, reference.sessionId, DEFAULT_SESSION_BRANCH_ID, createdAt);
    }
  });
  const snapshot = loadSqliteSessionSnapshot(database, reference, tableNames);
  return Object.freeze({
    ...reference,
    branchId: snapshot.navigation.selectedBranchId,
    navigationRevision: snapshot.navigation.revision,
  });
}

function inheritCompaction(
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
