import type { SessionId } from '../../contracts/index.js';
import { AgentSessionError } from '../../errors.js';
import type { ValidatedSessionNavigationCommand } from '../types/command.js';
import type { SessionNavigationExecutionState } from './types.js';

export function requireValidatedState(
  state: SessionNavigationExecutionState
): Readonly<{ command: ValidatedSessionNavigationCommand; sessionId: SessionId }> {
  if (state.command === undefined || state.sessionId === undefined) {
    throw new AgentSessionError(
      'SESSION_NAVIGATION_INVALID',
      'Session navigation state is incomplete.'
    );
  }
  return Object.freeze({ command: state.command, sessionId: state.sessionId });
}
