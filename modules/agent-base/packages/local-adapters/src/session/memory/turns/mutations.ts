import {
  AgentSessionError,
  defineSessionTurnPresentation,
  parseSessionFailureCode,
  type ActiveSessionTurn,
  type BeginSessionTurnRequest,
  type CompleteSessionTurnRequest,
  type CompleteSessionTurnWithPresentationRequest,
  type CompletedSessionTurn,
  type FailSessionTurnRequest,
  type SessionTurn,
  type SessionTurnPresentation,
} from '@print-an-agent/base-session';
import { advanceMemoryExecution } from '../lifecycle/state.js';
import { readMemoryClock, touchMemorySession } from '../state/clock.js';
import { cloneMemoryTurn } from '../state/cloning.js';
import { requireMemoryBranch, requireMemoryTurnIndex } from '../state/lookup.js';
import type { MemorySessionAuthority } from '../types/lifecycle.js';
import type { MemorySessionState } from '../types/state.js';
import { completeMemorySessionTurn } from './completion.js';

export function beginMemoryTurn(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  request: BeginSessionTurnRequest
): Promise<ActiveSessionTurn> {
  return Promise.resolve().then(() => {
    const session = authority.assertWrite(request);
    if ([...session.memoryRecords.values()].some((record) => !record.settled))
      throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Memory coordination is unsettled.');
    if (
      request.navigationRevision !== session.navigationRevision ||
      request.branchId !== session.selectedBranchId
    ) {
      throw new AgentSessionError(
        'SESSION_NAVIGATION_CONFLICT',
        'Session selection changed before the request turn began.'
      );
    }
    const branch = requireMemoryBranch(session, request.branchId);
    if (session.turns.some((turn) => turn.turnId === request.turnId)) {
      throw new AgentSessionError(
        'TURN_ALREADY_EXISTS',
        `Turn "${request.turnId}" already exists in session "${request.sessionId}".`
      );
    }
    if (
      session.turns.some((turn) => turn.status === 'active' && turn.branchId === request.branchId)
    ) {
      throw new AgentSessionError(
        'SESSION_BRANCH_BUSY',
        `Session branch "${request.branchId}" already has an active turn.`
      );
    }
    const turn: ActiveSessionTurn = Object.freeze({
      status: 'active',
      turnId: request.turnId,
      branchId: request.branchId,
      ...(branch.headTurnId === undefined ? {} : { parentTurnId: branch.headTurnId }),
      userMessage: Object.freeze({ ...request.userMessage }),
    });
    const updatedAt = readMemoryClock(state.clock);
    session.turns.push(turn);
    advanceMemoryExecution(session);
    touchMemorySession(session, updatedAt);
    return cloneMemoryTurn(turn);
  });
}

export function completeMemoryTurn(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  request: CompleteSessionTurnRequest,
  presentation?: SessionTurnPresentation
): Promise<CompletedSessionTurn> {
  return Promise.resolve().then(() => {
    const session = authority.assertWrite(request);
    const result = completeMemorySessionTurn(session, request, state.clock, presentation);
    advanceMemoryExecution(session);
    return result;
  });
}

export function failMemoryTurn(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  request: FailSessionTurnRequest
): Promise<SessionTurn> {
  return Promise.resolve().then(() => {
    const failureCode = parseSessionFailureCode(request.failureCode);
    const session = authority.assertWrite(request);
    const index = requireMemoryTurnIndex(session, request.turnId);
    const current = session.turns[index];
    if (current === undefined) {
      throw new AgentSessionError('TURN_NOT_FOUND', `Turn "${request.turnId}" does not exist.`);
    }
    if (current.status !== 'active') return cloneMemoryTurn(current);
    const updatedAt = readMemoryClock(state.clock);
    const failed: SessionTurn = Object.freeze({
      status: 'failed',
      turnId: current.turnId,
      branchId: current.branchId,
      ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
      userMessage: current.userMessage,
      failureCode,
    });
    session.turns[index] = failed;
    advanceMemoryExecution(session);
    touchMemorySession(session, updatedAt);
    return cloneMemoryTurn(failed);
  });
}

export function completeMemoryTurnWithPresentation(
  state: MemorySessionState,
  authority: MemorySessionAuthority,
  request: CompleteSessionTurnWithPresentationRequest
): Promise<CompletedSessionTurn> {
  return Promise.resolve().then(() =>
    completeMemoryTurn(
      state,
      authority,
      request,
      defineSessionTurnPresentation(request.presentation)
    )
  );
}
