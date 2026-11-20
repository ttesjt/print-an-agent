import { AgentSessionError } from '../../../../errors.js';
import { refineSessionCompactionPromptTarget } from '../../../planning/feedback.js';
import { SESSION_COMPACTION_REJECTION_REASON as REJECTION } from '../../../rejection-reasons.js';
import { requireCompactionState } from '../../state-access.js';
import type { SessionCompactionWorkflowContext } from '../../types.js';

export function refineCompactionPlan(context: SessionCompactionWorkflowContext): Promise<void> {
  const assessment = requireCompactionState(context, 'assessment');
  if (assessment.status !== 'rejected')
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Refinement requires a rejected candidate.'
    );
  const current = requireCompactionState(context, 'plannerTargetTokens');
  const policy = context.resources.policy;
  context.state.plannerTargetTokens =
    assessment.reason === REJECTION.TOKEN_LIMIT && assessment.actualTokens !== undefined
      ? refineSessionCompactionPromptTarget({
          currentTargetTokens: current,
          actualTokens: assessment.actualTokens,
          targetTokens: requireCompactionState(context, 'targetTokens'),
          retrySafetyFactor: policy.retrySafetyFactor,
          minimumTargetTokens: policy.minimumTargetTokens,
        })
      : Math.max(policy.minimumTargetTokens, Math.floor(current * policy.retrySafetyFactor));
  return Promise.resolve();
}
