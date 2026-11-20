import { AgentSessionError } from '../../../errors.js';
import { resolveSessionCompactionTarget } from '../../planning/target.js';
import type { SessionCompactionWorkflowContext } from '../types.js';

export function resolveCompactionTarget(context: SessionCompactionWorkflowContext): Promise<void> {
  const { policy } = context.resources;
  const target = resolveSessionCompactionTarget(
    policy.maxContextTokens,
    policy.target,
    context.state.compactionInput.target
  );
  if (target < policy.minimumTargetTokens)
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Target is below the minimum planner target.'
    );
  context.state.targetTokens = target;
  context.state.plannerTargetTokens = target;
  return Promise.resolve();
}
