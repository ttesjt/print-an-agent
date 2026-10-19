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

export function compactionTimestamp(context: SessionCompactionWorkflowContext): number {
  const timestamp = context.resources.clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentSessionError('SESSION_COMPACTION_INVALID', 'Invalid compaction clock value.');
  }
  return timestamp;
}
