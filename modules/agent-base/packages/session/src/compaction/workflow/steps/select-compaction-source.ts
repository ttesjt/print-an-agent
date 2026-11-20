import { selectSessionCompactionSource } from '../../source-selection.js';
import { requireCompactionState } from '../state-access.js';
import type { SessionCompactionWorkflowContext } from '../types.js';

export function selectCompactionSource(context: SessionCompactionWorkflowContext): Promise<void> {
  const snapshot = requireCompactionState(context, 'snapshot');
  const branchId = requireCompactionState(context, 'branchId');
  const selection = selectSessionCompactionSource(
    snapshot,
    branchId,
    context.state.previousCompaction,
    context.resources.policy
  );
  if (selection.status === 'skipped') {
    context.state.outcome = Object.freeze({
      status: 'skipped',
      sessionId: snapshot.sessionId,
      branchId,
      reason: 'not-needed',
    });
  } else context.state.source = selection.source;
  return Promise.resolve();
}
