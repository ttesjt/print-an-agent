import type { ModelMemoryOperation } from '../../../model-update/index.js';
import { ContextMemoryError } from '../../../errors.js';
import { requirePreparedMemoryInput } from '../../shared/index.js';
import { modelMemorySignal } from '../execution/signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { checkMemoryInputBudget } from '../../../model-update/index.js';
import { requireUpdate } from './state.js';
import type { ModelMemorySteps } from '../types/steps.js';

export function memoryPreparationSteps(
  operation: ModelMemoryOperation
): Pick<ModelMemorySteps, 'prepareInput' | 'beginUpdate' | 'checkInputBudget'> {
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
  };
}
