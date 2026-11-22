import type { ModelMemoryInput, ModelMemoryOperation } from '../../model-update/index.js';
import type { ModelMemoryDefinition } from './types/workflow.js';
import { modelMemorySteps } from './steps/create-steps.js';
import { runModelMemory } from './execution/run-operation.js';

export function modelStepDefinitions<I extends ModelMemoryInput>(
  operation: ModelMemoryOperation
): ModelMemoryDefinition<I>['stepDefinitions'] {
  const steps = modelMemorySteps(operation);
  return {
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
  };
}
