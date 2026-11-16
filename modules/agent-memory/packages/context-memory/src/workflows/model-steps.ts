import type { ModelMemoryOperation } from '../contracts/model.js';
import { ContextMemoryError, assertMemoryNotAborted } from '../errors.js';
import { requirePreparedMemoryInput } from './input-preparation.js';
import { modelMemorySignal, type ModelMemoryContext } from './model-types.js';
import { checkMemoryInputBudget } from '../model/input-budget.js';
import { throwMemoryPlannerFailure } from '../model/failures.js';

export function requireUpdate(context: ModelMemoryContext) {
  if (context.state.update === undefined)
    throw new ContextMemoryError('INPUT_INVALID', 'Prepared Memory update is missing.');
  return context.state.update;
}
export function modelMemorySteps(operation: ModelMemoryOperation) {
  return {
    prepareInput(this: void, context: ModelMemoryContext) {
      context.state.prepareInput();
      return Promise.resolve();
    },
    async beginUpdate(this: void, context: ModelMemoryContext) {
      const result = await context.resources.updates.begin(
        operation,
        requirePreparedMemoryInput(context.state),
        modelMemorySignal(context)
      );
      if (result.status === 'replayed') context.state.operationOutput = { value: result.result };
      else context.state.update = result.update;
      context.state.compactionPasses = 0;
      delete context.state.plannerTargetTokens;
      delete context.state.assessment;
      delete context.state.measured;
      delete context.state.operations;
    },
    async checkInputBudget(this: void, context: ModelMemoryContext) {
      const limit = context.resources.policy.maxInputTokens;
      if (limit === null) return;
      const counter = context.resources.inputCounter;
      if (counter === undefined)
        throw new ContextMemoryError('CONFIG_INVALID', 'Input counter is unavailable.');
      await checkMemoryInputBudget(
        requireUpdate(context).input,
        counter,
        limit,
        modelMemorySignal(context)
      );
    },
    planUpdate: (context: ModelMemoryContext) => plan(context, operation),
    applyUpdate(this: void, context: ModelMemoryContext) {
      requireUpdate(context).edit(requireOperations(context));
      return Promise.resolve();
    },
    async measureCandidate(this: void, context: ModelMemoryContext) {
      context.state.measured = await requireUpdate(context).assess(modelMemorySignal(context));
    },
    assessCandidate(this: void, context: ModelMemoryContext) {
      if (context.state.measured === undefined)
        throw new ContextMemoryError('INPUT_INVALID', 'Candidate measurement is missing.');
      context.state.assessment = context.state.measured;
      return Promise.resolve();
    },
    planCompaction: (context: ModelMemoryContext) => plan(context, 'compact'),
    applyCompaction(this: void, context: ModelMemoryContext) {
      requireUpdate(context).edit(requireOperations(context), true);
      return Promise.resolve();
    },
    async refineCompactionPlan(this: void, context: ModelMemoryContext) {
      if (context.state.assessment === undefined || context.state.plannerTargetTokens === undefined)
        throw new ContextMemoryError('INPUT_INVALID', 'Compaction feedback is missing.');
      context.state.plannerTargetTokens = await context.resources.refine({
        assessment: context.state.assessment,
        currentTargetTokens: context.state.plannerTargetTokens,
        policy: context.resources.policy,
      });
    },
    async commitCandidate(this: void, context: ModelMemoryContext) {
      const value = await requireUpdate(context).commit(modelMemorySignal(context));
      context.state.operationOutput = { value };
    },
  };
}
function requireOperations(context: ModelMemoryContext) {
  if (context.state.operations === undefined)
    throw new ContextMemoryError('MODEL_OUTPUT_INVALID', 'Planner operations are missing.');
  return context.state.operations;
}
async function plan(context: ModelMemoryContext, task: ModelMemoryOperation): Promise<void> {
  const update = requireUpdate(context);
  const input = update.input;
  const textOnly = (items: typeof update.items) =>
    items.map(({ id, content }) => ({ id, content }));
  try {
    const operations = await context.resources.planner.plan(
      {
        task,
        source: textOnly(update.source.items),
        items: textOnly(update.items),
        context: input.context,
        ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
        ...(task === 'compact' && context.state.plannerTargetTokens !== undefined
          ? { targetTokens: context.state.plannerTargetTokens }
          : {}),
      },
      modelMemorySignal(context)
    );
    assertMemoryNotAborted(modelMemorySignal(context));
    context.state.operations = operations;
  } catch (cause) {
    throwMemoryPlannerFailure(cause, modelMemorySignal(context));
  }
}
