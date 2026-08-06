import type { BaseWorkflowContext } from '../types/context.js';
import type { Step, StepName } from '../types/step.js';

export function createSequentialStep<TStepName extends StepName>(
  ...stepNames: readonly TStepName[]
): Step<BaseWorkflowContext<TStepName>> {
  return async (context) => {
    for (const stepName of stepNames) {
      await context.runStep(stepName);
    }
  };
}
