import {
  AgentSessionError,
  isCompletedAncestor,
  parseSessionBranchId,
  toSessionNavigationSnapshot,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type SessionBranchId,
} from '@print-an-agent/base-session';
import {
  createMemorySessionSnapshot,
  inheritMemoryCompaction,
  touchMemorySession,
  type StoredMemorySession,
} from './session-state.js';

function requireMemoryBranch(session: StoredMemorySession, branchId: SessionBranchId): void {
  if (!session.branches.has(branchId)) {
    throw new AgentSessionError(
      'SESSION_BRANCH_NOT_FOUND',
      `Session branch "${branchId}" does not exist in session "${session.sessionId}".`
    );
  }
}

export function applyMemorySessionNavigation(
  session: StoredMemorySession,
  request: ApplySessionNavigationRequest,
  createBranchId: () => string,
  timestamp: number
): AppliedSessionNavigation {
  if (request.command.expectedRevision !== session.navigationRevision) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_CONFLICT',
      `Session navigation expected revision ${request.command.expectedRevision} but found ${session.navigationRevision}.`
    );
  }

  let affectedBranchId: SessionBranchId;
  if (request.command.operation === 'select') {
    requireMemoryBranch(session, request.command.branchId);
    session.selectedBranchId = request.command.branchId;
    affectedBranchId = request.command.branchId;
  } else {
    const sourceBranchId =
      request.command.operation === 'fork'
        ? request.command.sourceBranchId
        : session.selectedBranchId;
    requireMemoryBranch(session, sourceBranchId);
    const snapshot = createMemorySessionSnapshot(session);
    if (!isCompletedAncestor(snapshot, sourceBranchId, request.command.throughTurnId)) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_TARGET_INVALID',
        'Session navigation target must be a completed ancestor of the source branch.'
      );
    }

    affectedBranchId = parseSessionBranchId(request.command.newBranchId ?? createBranchId());
    if (session.branches.has(affectedBranchId)) {
      throw new AgentSessionError(
        'SESSION_BRANCH_ALREADY_EXISTS',
        `Session branch "${affectedBranchId}" already exists.`
      );
    }
    session.branches.set(affectedBranchId, {
      branchId: affectedBranchId,
      parentBranchId: sourceBranchId,
      forkedFromTurnId: request.command.throughTurnId,
      headTurnId: request.command.throughTurnId,
      createdAt: timestamp,
    });
    inheritMemoryCompaction(
      session,
      snapshot,
      sourceBranchId,
      affectedBranchId,
      request.command.throughTurnId
    );
    if (request.command.operation === 'rewind') {
      session.selectedBranchId = affectedBranchId;
    }
  }

  session.navigationRevision += 1;
  touchMemorySession(session, timestamp);
  return Object.freeze({
    operation: request.command.operation,
    affectedBranchId,
    navigation: toSessionNavigationSnapshot(createMemorySessionSnapshot(session)),
  });
}
