import { ContextMemoryError, assertMemoryNotAborted } from '../../../errors.js';
import { modelMemorySignal } from './signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { requireUpdate } from '../steps/state.js';
import { yieldMemoryRetry } from './yield-retry.js';
import { requireCandidateAssessment, measureCandidate } from './candidate.js';

export async function runCompactionCycle(context: ModelMemoryContext): Promise<void> {
  const { policy } = context.resources;
  const update = requireUpdate(context);
  while (!requireCandidateAssessment(context).accepted) {
    if (context.state.compactionPasses > 0) await yieldMemoryRetry(context);
    assertMemoryNotAborted(modelMemorySignal(context));
    if (
      policy.maxCompactionPasses !== null &&
      context.state.compactionPasses >= policy.maxCompactionPasses
    )
      throw new ContextMemoryError('COMPACTION_EXHAUSTED', 'Compaction attempts were exhausted.', {
        details: {
          passes: context.state.compactionPasses,
          actualTokens: requireCandidateAssessment(context).actualTokens,
          targetTokens: update.targetTokens ?? null,
          reason: 'budget-unsatisfied',
          violations: requireCandidateAssessment(context).violations.map(
            ({ kind, actual, limit }) => ({
              kind,
              actual,
              limit,
            })
          ),
        },
      });
    const target = update.targetTokens;
    if (target === undefined || target < policy.minPlannerTargetTokens)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Compaction target is below the configured planner minimum.'
      );
    context.state.plannerTargetTokens ??= target;
    const soft = context.state.plannerTargetTokens;
    if (!Number.isSafeInteger(soft) || soft < policy.minPlannerTargetTokens || soft > target)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Planner target is outside the fixed target bounds.'
      );
    context.state.compactionPasses++;
    await context.runStep('planCompaction');
    await context.runStep('applyCompaction');
    await measureCandidate(context);
    if (context.state.update !== update)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Candidate Steps replaced the source update capability.'
      );
    if (
      !requireCandidateAssessment(context).accepted &&
      (policy.maxCompactionPasses === null ||
        context.state.compactionPasses < policy.maxCompactionPasses)
    )
      await context.runStep('refineCompactionPlan');
  }
}
