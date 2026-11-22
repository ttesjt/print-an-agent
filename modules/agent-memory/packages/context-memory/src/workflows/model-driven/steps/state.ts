import type { MemoryUpdate, ModelEditOperation } from '../../../model-update/index.js';
import { ContextMemoryError } from '../../../errors.js';
import type { ModelMemoryContext } from '../types/workflow.js';

export function requireUpdate(context: ModelMemoryContext): MemoryUpdate {
  if (context.state.update === undefined)
    throw new ContextMemoryError('INPUT_INVALID', 'Prepared Memory update is missing.');
  return context.state.update;
}

export function requireOperations(context: ModelMemoryContext): readonly ModelEditOperation[] {
  if (context.state.operations === undefined)
    throw new ContextMemoryError('MODEL_OUTPUT_INVALID', 'Planner operations are missing.');
  return context.state.operations;
}
