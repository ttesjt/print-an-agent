import {
  AgentSessionError,
  type AgentSessionErrorCode,
  type SessionMemoryRecord,
} from '@print-an-agent/base-session';
import { parseMemoryReceipt } from '@print-an-agent/context-memory';
import { SessionMemoryCommitError } from '../errors.js';
import { hasSessionMemoryCleanupFailure } from '../failures.js';
import { payload } from '../journal.js';

export function terminalNavigationCode(value: unknown): AgentSessionErrorCode | undefined {
  switch (value) {
    case 'SESSION_BRANCH_ALREADY_EXISTS':
    case 'SESSION_BRANCH_NOT_FOUND':
    case 'SESSION_NAVIGATION_CONFLICT':
    case 'SESSION_NAVIGATION_TARGET_INVALID':
    case 'SESSION_NAVIGATION_INVALID':
      return value;
    default:
      return undefined;
  }
}

function rejectionCode(state: Record<string, unknown>): AgentSessionErrorCode | undefined {
  return (
    terminalNavigationCode(state.rejected) ??
    (state.skippedReason === undefined ? undefined : 'SESSION_MEMORY_NOT_CONFIGURED')
  );
}

export function isSettledNavigationRejection(row: SessionMemoryRecord, cause: unknown): boolean {
  const state = payload(row);
  return (
    row.settled &&
    state.cleanupPending !== true &&
    !hasSessionMemoryCleanupFailure(cause) &&
    cause instanceof AgentSessionError &&
    rejectionCode(state) === cause.code
  );
}

export function rejectedNavigation(state: Record<string, unknown>): AgentSessionError {
  const code = rejectionCode(state);
  if (code === undefined)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation rejection.');
  const cause = new AgentSessionError(code, 'Session navigation was not published.');
  if (state.receipt !== undefined)
    return new SessionMemoryCommitError(
      { status: 'committed', receipt: parseMemoryReceipt(state.receipt) },
      cause,
      code
    );
  if (state.skippedReason !== undefined)
    return new SessionMemoryCommitError({ status: 'not-committed' }, cause, code);
  return cause;
}
