import type {
  CompactMemoryInput,
  EditMemoryInput,
  ModelMemoryInput,
  ModelMemoryOperation,
  ObserveMemoryInput,
} from '../contracts/model.js';
import type { ModelMemoryDefinition, ModelMemoryWorkflowOptions } from './model-types.js';
import { modelMemorySteps } from './model-steps.js';
import { runModelMemory } from './model-composite.js';
import { memoryLifecycle } from './lifecycle.js';
import { memoryExecutor } from './outcome.js';

function definition<I extends ModelMemoryInput>(
  operation: ModelMemoryOperation,
  options: ModelMemoryWorkflowOptions<I>
): ModelMemoryDefinition<I> {
  const steps = modelMemorySteps(operation);
  return {
    ...options,
    name: `context-memory.${operation}`,
    entryStep: 'runModelOperation',
    createResult: () => ({ status: 'skipped', reason: 'condition-not-met' }),
    createState: () => ({ compactionPasses: 0, conflictRetries: 0 }),
    executeStep: memoryExecutor(options.executeStep),
    lifecycle: memoryLifecycle(options.lifecycle),
    stepDefinitions: {
      runModelOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: (context) => runModelMemory(context, operation),
      },
      prepareInput: { skippable: false, cardinality: 'at-most-once', step: steps.prepareInput },
      beginUpdate: { skippable: false, cardinality: 'repeatable', step: steps.beginUpdate },
      checkInputBudget: {
        skippable: false,
        cardinality: 'repeatable',
        step: steps.checkInputBudget,
      },
      planUpdate: { skippable: false, cardinality: 'repeatable', step: steps.planUpdate },
      applyUpdate: { skippable: false, cardinality: 'repeatable', step: steps.applyUpdate },
      measureCandidate: {
        skippable: false,
        cardinality: 'repeatable',
        step: steps.measureCandidate,
      },
      assessCandidate: { skippable: false, cardinality: 'repeatable', step: steps.assessCandidate },
      planCompaction: { skippable: false, cardinality: 'repeatable', step: steps.planCompaction },
      applyCompaction: { skippable: false, cardinality: 'repeatable', step: steps.applyCompaction },
      refineCompactionPlan: {
        skippable: false,
        cardinality: 'repeatable',
        step: steps.refineCompactionPlan,
      },
      commitCandidate: { skippable: false, cardinality: 'repeatable', step: steps.commitCandidate },
    },
  };
}
export function createMemoryObserveDefinition(
  options: ModelMemoryWorkflowOptions<ObserveMemoryInput> = {}
) {
  return definition('observe', options);
}
export function createMemoryEditDefinition(
  options: ModelMemoryWorkflowOptions<EditMemoryInput> = {}
) {
  return definition('edit', options);
}
export function createMemoryCompactDefinition(
  options: ModelMemoryWorkflowOptions<CompactMemoryInput> = {}
) {
  return definition('compact', options);
}
