import { ContextMemoryError } from '../../../errors.js';
import { modelMemorySignal } from '../execution/signal.js';
import type { ModelMemoryContext } from '../types/workflow.js';
import { requireUpdate, requireOperations } from './state.js';
import type { ModelMemorySteps } from '../types/steps.js';

export function memoryCandidateSteps(): Pick<
  ModelMemorySteps,
  'applyUpdate' | 'measureCandidate' | 'assessCandidate' | 'applyCompaction' | 'commitCandidate'
> {
  return {
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
    applyCompaction(this: void, context: ModelMemoryContext) {
      requireUpdate(context).edit(requireOperations(context), true);
      return Promise.resolve();
    },
    async commitCandidate(this: void, context: ModelMemoryContext) {
      const value = await requireUpdate(context).commit(modelMemorySignal(context));
      context.state.operationOutput = { value };
    },
  };
}
