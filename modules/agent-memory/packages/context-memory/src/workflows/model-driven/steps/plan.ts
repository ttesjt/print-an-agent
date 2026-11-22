import type { ModelMemoryOperation } from '../../../model-update/index.js';
import { assertMemoryNotAborted } from '../../../errors.js';
import { modelMemorySignal } from '../execution/signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { throwMemoryPlannerFailure } from '../../../model-update/index.js';
import { requireUpdate } from './state.js';

export async function plan(context: ModelMemoryContext, task: ModelMemoryOperation): Promise<void> {
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
