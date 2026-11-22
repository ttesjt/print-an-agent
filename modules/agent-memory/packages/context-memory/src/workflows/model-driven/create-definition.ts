import { modelStepDefinitions } from './step-definitions.js';
import type {
  CompactMemoryInput,
  EditMemoryInput,
  ModelMemoryInput,
  ModelMemoryOperation,
  ObserveMemoryInput,
} from '../../model-update/index.js';
import type { ModelMemoryDefinition, ModelMemoryWorkflowOptions } from './types/workflow.js';
import {
  memoryLifecycle,
  memoryExecutor,
  requireMemoryOperationOutput,
  createModelMemoryInputState,
} from '../shared/index.js';

function definition<I extends ModelMemoryInput>(
  operation: ModelMemoryOperation,
  options: ModelMemoryWorkflowOptions<I>
): ModelMemoryDefinition<I> {
  return {
    ...options,
    name: `context-memory.${operation}`,
    entryStep: 'runModelOperation',
    createSkippedResult: () => ({ status: 'skipped', reason: 'condition-not-met' }),
    createResult: requireMemoryOperationOutput,
    createState: ({ input }) =>
      createModelMemoryInputState(input, { compactionPasses: 0, conflictRetries: 0 }),
    executeStep: memoryExecutor(options.executeStep),
    lifecycle: memoryLifecycle(options.lifecycle),
    stepDefinitions: modelStepDefinitions<I>(operation),
  };
}

export function createMemoryObserveDefinition(
  options: ModelMemoryWorkflowOptions<ObserveMemoryInput> = {}
): ModelMemoryDefinition<ObserveMemoryInput> {
  return definition('observe', options);
}

export function createMemoryEditDefinition(
  options: ModelMemoryWorkflowOptions<EditMemoryInput> = {}
): ModelMemoryDefinition<EditMemoryInput> {
  return definition('edit', options);
}

export function createMemoryCompactDefinition(
  options: ModelMemoryWorkflowOptions<CompactMemoryInput> = {}
): ModelMemoryDefinition<CompactMemoryInput> {
  return definition('compact', options);
}
