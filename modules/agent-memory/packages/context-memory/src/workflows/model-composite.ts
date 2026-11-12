import { runWithExecutionTimeout } from '@print-an-agent/workflow-core';
import type { ModelMemoryOperation } from '../contracts/model.js';
import { ContextMemoryError, assertMemoryNotAborted } from '../errors.js';
import {
  bindModelMemorySignal,
  modelMemorySignal,
  type ModelMemoryContext,
} from './model-types.js';
import { requireUpdate } from './model-steps.js';
import { isMemoryPlannerTimeout } from '../model/failures.js';
import { preserveMemoryCommit } from './outcome.js';

/** A resolved Promise only yields microtasks; retries must also admit timers and external aborts. */
async function yieldRetry(context: ModelMemoryContext) {
  assertMemoryNotAborted(modelMemorySignal(context));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assertMemoryNotAborted(modelMemorySignal(context));
}

function assessment(context: ModelMemoryContext) {
  if (context.state.assessment === undefined)
    throw new ContextMemoryError('INPUT_INVALID', 'Candidate assessment is missing.');
  return context.state.assessment;
}
async function measure(context: ModelMemoryContext) {
  await context.runStep('measureCandidate');
  await context.runStep('assessCandidate');
}
async function compact(context: ModelMemoryContext) {
  const { policy } = context.resources;
  const update = requireUpdate(context);
  while (!assessment(context).accepted) {
    if (context.state.compactionPasses > 0) await yieldRetry(context);
    assertMemoryNotAborted(modelMemorySignal(context));
    if (
      policy.maxCompactionPasses !== null &&
      context.state.compactionPasses >= policy.maxCompactionPasses
    )
      throw new ContextMemoryError('COMPACTION_EXHAUSTED', 'Compaction attempts were exhausted.', {
        details: {
          passes: context.state.compactionPasses,
          actualTokens: assessment(context).actualTokens,
          targetTokens: update.targetTokens ?? null,
          reason: 'budget-unsatisfied',
          violations: assessment(context).violations.map(({ kind, actual, limit }) => ({
            kind,
            actual,
            limit,
          })),
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
    await measure(context);
    if (context.state.update !== update)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Candidate Steps replaced the source update capability.'
      );
    if (
      !assessment(context).accepted &&
      (policy.maxCompactionPasses === null ||
        context.state.compactionPasses < policy.maxCompactionPasses)
    )
      await context.runStep('refineCompactionPlan');
  }
}
async function execute(context: ModelMemoryContext, operation: ModelMemoryOperation) {
  await context.runStep('prepareInput');
  while (true) {
    assertMemoryNotAborted(modelMemorySignal(context));
    await context.runStep('beginUpdate');
    if (context.result.status !== 'skipped') return;
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
    await measure(context);
    if (requireUpdate(context) !== update)
      throw new ContextMemoryError(
        'CONFIG_INVALID',
        'Planning Steps replaced the source update capability.'
      );
    await compact(context);
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
      await yieldRetry(context);
    }
  }
}
/** One domain deadline for the complete run, not a renewed timer per generation. */
export async function runModelMemory(context: ModelMemoryContext, operation: ModelMemoryOperation) {
  try {
    await runWithExecutionTimeout(
      {
        parentSignal: context.signal,
        timeoutMilliseconds: context.resources.policy.timeoutMs,
        createTimeoutFailure: ({ cause }) =>
          isMemoryPlannerTimeout(cause)
            ? cause
            : new ContextMemoryError(
                'OPERATION_TIMEOUT',
                'Memory operation exceeded its deadline.',
                {
                  cause,
                  commit:
                    context.result.status !== 'skipped'
                      ? { status: 'committed', receipt: context.result.receipt }
                      : cause instanceof ContextMemoryError && cause.commit !== undefined
                        ? cause.commit
                        : { status: 'not-committed' },
                }
              ),
      },
      async (signal) => {
        bindModelMemorySignal(context, signal);
        await execute(context, operation);
      }
    );
  } catch (cause) {
    const failure = preserveMemoryCommit(cause, context.result);
    if (failure !== cause) throw failure;
    if (cause instanceof ContextMemoryError && cause.commit !== undefined) throw cause;
    assertMemoryNotAborted(modelMemorySignal(context));
    if (cause instanceof ContextMemoryError)
      throw new ContextMemoryError(cause.code, cause.message, {
        cause,
        details: cause.details,
        commit: { status: 'not-committed' },
      });
    throw cause;
  }
}
