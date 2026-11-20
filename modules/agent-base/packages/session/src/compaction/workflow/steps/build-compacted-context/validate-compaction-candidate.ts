import { SESSION_COMPACTION_REJECTION_REASON as REJECTION } from '../../../rejection-reasons.js';
import { requireCompactionState } from '../../state-access.js';
import type { SessionCompactionWorkflowContext } from '../../types.js';

export function validateCompactionCandidate(
  context: SessionCompactionWorkflowContext
): Promise<void> {
  if (context.state.assessment !== undefined) return Promise.resolve();
  const candidate = requireCompactionState(context, 'candidate');
  if (candidate.stopReason === 'length' || candidate.text.trim().length === 0) {
    delete context.state.draft;
    context.state.assessment = Object.freeze({
      status: 'rejected',
      reason: candidate.stopReason === 'length' ? REJECTION.TRUNCATED : REJECTION.EMPTY,
    });
    return Promise.resolve();
  }
  const actualTokens = requireCompactionState(context, 'candidateTokens');
  if (actualTokens > requireCompactionState(context, 'targetTokens')) {
    context.state.draft = candidate.text;
    context.state.assessment = Object.freeze({
      status: 'rejected',
      reason: REJECTION.TOKEN_LIMIT,
      actualTokens,
    });
  } else context.state.assessment = Object.freeze({ status: 'accepted', actualTokens });
  return Promise.resolve();
}
