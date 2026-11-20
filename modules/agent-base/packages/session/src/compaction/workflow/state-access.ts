import { AgentSessionError } from '../../errors.js';
import type { SessionCompactionState, SessionCompactionWorkflowContext } from './types.js';

export function requireCompactionState<K extends keyof SessionCompactionState>(
  context: SessionCompactionWorkflowContext,
  field: K
): NonNullable<SessionCompactionState[K]> {
  const value = context.state[field];
  if (value === undefined || value === null) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      `Compaction Step requires ${field} in its Run state.`
    );
  }
  return value;
}
