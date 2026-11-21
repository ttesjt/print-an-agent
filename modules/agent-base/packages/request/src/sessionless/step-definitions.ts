import { STEP_CARDINALITY, type Step, type StepDefinition } from '@print-an-agent/workflow-core';
export function requiredStep<C>(step: Step<C>): StepDefinition<C> {
  return { step, cardinality: STEP_CARDINALITY.AT_MOST_ONCE, skippable: false };
}
export function repeatableStep<C>(step: Step<C>, skippable = false): StepDefinition<C> {
  return { step, cardinality: STEP_CARDINALITY.REPEATABLE, skippable };
}
