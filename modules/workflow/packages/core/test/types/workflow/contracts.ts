import * as core from '@print-an-agent/workflow-core';
import type { WorkflowDefinition, RunnableWorkflow } from '@print-an-agent/workflow-core';

type Input = { readonly value: number };
type State = { total: number };
interface Resources {
  increment(value: number): number;
}
type Result = { readonly total: number } | { readonly skipped: string };
const definition: WorkflowDefinition<'main', Input, State, Resources, Result> = {
  name: 'typed.public',
  resources: { increment: (value) => value + 1 },
  entryStep: 'main',
  createState: ({ input }) => ({ total: input.value }),
  createResult: ({ total }) => ({ total }),
  createSkippedResult: ({ reason }) => ({ skipped: reason }),
  stepDefinitions: {
    main: {
      cardinality: core.STEP_CARDINALITY.AT_MOST_ONCE,
      skippable: false,
      step: (context) => {
        context.state.total = context.resources.increment(context.state.total);
        return Promise.resolve();
      },
    },
  },
};

// Construction infers all five parameters from a consumer-authored definition.
const workflow = new core.Workflow(definition);
const callable: RunnableWorkflow<Input, Result> = workflow;
void callable;

export function checkPublicContracts(): void {
  const result: Promise<Result> = workflow.run({ input: { value: 1 } });
  void result;
  // @ts-expect-error The inferred input remains the consumer's Input.
  void workflow.run({ input: 'wrong input' });
  // @ts-expect-error Assembly-bound Resources cannot be replaced at Run time.
  void workflow.run({ input: { value: 1 }, resources: definition.resources });
  // @ts-expect-error Definition preparation is private to the Workflow feature.
  void core.prepareWorkflowDefinition;
  // @ts-expect-error The dispatch kernel is internal to the package.
  void core.StepRuntime;
}
