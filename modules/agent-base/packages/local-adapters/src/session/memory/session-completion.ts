import { defineAssistantModelMessage } from '@ta-agent/base-model';
import {
  AgentSessionError,
  type CompleteSessionTurnRequest,
  type CompletedSessionTurn,
  type SessionTurnPresentation,
} from '@ta-agent/base-session';
import {
  cloneMemoryTurn,
  readMemoryClock,
  touchMemorySession,
  type StoredMemorySession,
} from './session-state.js';

/** All fallible validation precedes the synchronous, non-interleaved commit. */
export function completeMemorySessionTurn(
  session: StoredMemorySession,
  request: CompleteSessionTurnRequest,
  clock: () => number,
  presentation?: SessionTurnPresentation
): CompletedSessionTurn {
  const index = session.turns.findIndex((turn) => turn.turnId === request.turnId);
  const current = session.turns[index];
  if (current === undefined)
    throw new AgentSessionError('TURN_NOT_FOUND', 'Session turn does not exist.');
  if (current.status !== 'active')
    throw new AgentSessionError('TURN_STATE_INVALID', 'Only an active turn can complete.');
  const branch = session.branches.get(current.branchId);
  if (branch === undefined)
    throw new AgentSessionError('SESSION_BRANCH_NOT_FOUND', 'Session branch does not exist.');
  if (branch.headTurnId !== current.parentTurnId) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_CONFLICT',
      'Session branch head changed before the active turn completed.'
    );
  }
  const completed: CompletedSessionTurn = Object.freeze({
    status: 'completed',
    turnId: current.turnId,
    branchId: current.branchId,
    ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
    userMessage: current.userMessage,
    assistantMessage: defineAssistantModelMessage(request.assistantMessage),
  });
  const result = cloneMemoryTurn(completed);
  const updatedAt = readMemoryClock(clock);
  session.turns[index] = completed;
  if (presentation !== undefined) session.presentations.set(completed.turnId, presentation);
  branch.headTurnId = completed.turnId;
  session.navigationRevision += 1;
  touchMemorySession(session, updatedAt);
  return result;
}
