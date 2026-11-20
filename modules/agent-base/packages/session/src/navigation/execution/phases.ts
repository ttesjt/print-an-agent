import { AgentSessionError } from '../../errors.js';
import { supportsSessionExecution } from '../../lifecycle/index.js';
import { toSessionNavigationSnapshot } from '../snapshot.js';
import type { SessionNavigationOutcome } from '../types/outcome.js';
import { parseSessionNavigationInput } from './command.js';
import { requireValidatedState } from './state-access.js';
import type { SessionNavigationCommit, SessionNavigationExecutionState } from './types.js';

function cancelled(signal: AbortSignal): never {
  throw new AgentSessionError(
    'SESSION_NAVIGATION_CANCELLED',
    'Session navigation was cancelled before its commit boundary.',
    signal.reason === undefined ? undefined : { cause: signal.reason }
  );
}

function assertSessionNavigationActive(signal: AbortSignal): void {
  if (signal.aborted) cancelled(signal);
}

export function validateSessionNavigationState(
  state: SessionNavigationExecutionState,
  signal: AbortSignal
): void {
  assertSessionNavigationActive(signal);
  const input = parseSessionNavigationInput(state.input);
  state.sessionId = input.sessionId;
  state.command = input.command;
}

export async function inspectSessionNavigationState(
  state: SessionNavigationExecutionState,
  signal: AbortSignal
): Promise<SessionNavigationOutcome | undefined> {
  const { command, sessionId } = requireValidatedState(state);
  assertSessionNavigationActive(signal);
  if (command.operation !== 'inspect' && supportsSessionExecution(state.resources.session)) {
    state.execution = await state.resources.session.acquireSessionExecution({
      agentId: state.agentId,
      sessionId,
    });
    assertSessionNavigationActive(signal);
  }
  const snapshot = await state.resources.session.inspect({
    agentId: state.agentId,
    sessionId,
  });
  if (snapshot === undefined) {
    throw new AgentSessionError(
      'SESSION_NOT_FOUND',
      `Session "${sessionId}" does not exist for agent "${state.agentId}".`
    );
  }
  state.snapshot = snapshot;
  assertSessionNavigationActive(signal);
  if (command.operation === 'inspect') {
    return Object.freeze({
      status: 'inspected',
      navigation: toSessionNavigationSnapshot(snapshot),
    });
  }
}

function outcomeStatus(operation: 'select' | 'fork' | 'rewind') {
  return operation === 'select' ? 'selected' : operation === 'fork' ? 'forked' : 'rewound';
}

export async function commitSessionNavigationState(
  state: SessionNavigationExecutionState,
  signal: AbortSignal
): Promise<SessionNavigationCommit | undefined> {
  const { command, sessionId } = requireValidatedState(state);
  if (command.operation === 'inspect') return undefined;
  assertSessionNavigationActive(signal);
  const applied = await state.resources.session.applyNavigation({
    agentId: state.agentId,
    sessionId,
    command,
    signal,
    ...(state.execution === undefined ? {} : { execution: state.execution }),
  });
  const result = Object.freeze({
    status: outcomeStatus(applied.operation),
    sessionId,
    selectedBranchId: applied.navigation.selectedBranchId,
    affectedBranchId: applied.affectedBranchId,
    revision: applied.navigation.revision,
  });
  return Object.freeze({ applied, result });
}
