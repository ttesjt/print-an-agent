import type { ModelMemoryOperation } from '../../../model-update/index.js';
import { ContextMemoryError } from '../../../errors.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { plan } from './plan.js';
import type { ModelMemorySteps } from '../types/steps.js';

export function memoryPlanningSteps(
  operation: ModelMemoryOperation
): Pick<ModelMemorySteps, 'planUpdate' | 'planCompaction' | 'refineCompactionPlan'> {
  return {
    planUpdate: (context: ModelMemoryContext) => plan(context, operation),
    planCompaction: (context: ModelMemoryContext) => plan(context, 'compact'),
    async refineCompactionPlan(this: void, context: ModelMemoryContext) {
      if (context.state.assessment === undefined || context.state.plannerTargetTokens === undefined)
        throw new ContextMemoryError('INPUT_INVALID', 'Compaction feedback is missing.');
      context.state.plannerTargetTokens = await context.resources.refine({
        assessment: context.state.assessment,
        currentTargetTokens: context.state.plannerTargetTokens,
        policy: context.resources.policy,
      });
    },
  };
}
