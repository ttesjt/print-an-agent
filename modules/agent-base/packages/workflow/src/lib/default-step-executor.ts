import type { BaseWorkflowContext } from '../types/context.js';
import type { StepExecution, StepName } from '../types/step.js';

export async function defaultStepExecutor<
  TStepName extends StepName,
  C extends BaseWorkflowContext<TStepName>,
>({ context, step }: StepExecution<TStepName, C>): Promise<void> {
  await step(context);
}
