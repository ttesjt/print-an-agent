import type { ModelMemoryOperation } from '../../../model-update/index.js';
import { ContextMemoryError, assertMemoryNotAborted } from '../../../errors.js';
import { modelMemorySignal } from './signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { requireUpdate } from '../steps/state.js';
import { yieldMemoryRetry } from './yield-retry.js';
import { measureCandidate } from './candidate.js';
import { runCompactionCycle } from './compact-candidate.js';

export async function runUpdateCycles(
  context: ModelMemoryContext,
  operation: ModelMemoryOperation
): Promise<void> {
  await context.runStep('prepareInput');
  while (true) {
    assertMemoryNotAborted(modelMemorySignal(context));
    await context.runStep('beginUpdate');
    const output = context.state.operationOutput?.value;
    if (output !== undefined && output.status !== 'skipped') return;
    const update = requireUpdate(context);
    if (
      update.targetTokens !== undefined &&
      update.targetTokens < context.resources.policy.minPlannerTargetTokens
    )
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Compaction target is below the configured planner minimum.'
      );
    await context.runStep('checkInputBudget');
    if (operation !== 'compact') {
      await context.runStep('planUpdate');
      await context.runStep('applyUpdate');
    }
    await measureCandidate(context);
    if (requireUpdate(context) !== update)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Planning Steps replaced the source update capability.'
      );
    await runCompactionCycle(context);
    try {
      await context.runStep('commitCandidate');
      return;
    } catch (cause) {
      if (
        !(cause instanceof ContextMemoryError) ||
        cause.code !== 'REVISION_CONFLICT' ||
        cause.commit?.status !== 'not-committed'
      )
        throw cause;
      const limit = context.resources.policy.maxConflictRetries;
      if (limit !== null && context.state.conflictRetries >= limit)
        throw new ContextMemoryError(
          'CONFLICT_RETRIES_EXHAUSTED',
          'Memory conflict replanning was exhausted.',
          {
            cause,
            details: { retries: context.state.conflictRetries },
            commit: { status: 'not-committed' },
          }
        );
      context.state.conflictRetries++;
      await yieldMemoryRetry(context);
    }
  }
}
