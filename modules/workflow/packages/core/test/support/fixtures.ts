import {
  STEP_CARDINALITY,
  Workflow,
  type Step,
  type WorkflowContext,
  type WorkflowDefinition,
} from '@print-an-agent/workflow-core';

export type Names = 'main' | 'a' | 'b' | 'c';
export type Context = WorkflowContext<
  Names,
  number,
  { values: number[] },
  { label: string },
  number[]
>;
export const once = (step: Step<Context>, skippable = false) => ({
  step,
  skippable,
  cardinality: STEP_CARDINALITY.AT_MOST_ONCE,
});
export function workflow(
  main: Step<Context>,
  changes: Partial<
    WorkflowDefinition<Names, number, { values: number[] }, { label: string }, number[]>
  > = {}
) {
  return new Workflow<Names, number, { values: number[] }, { label: string }, number[]>({
    name: 'test',
    resources: { label: 'borrowed' },
    entryStep: 'main',
    createResult: () => [],
    createState: () => ({ values: [] }),
    stepDefinitions: {
      main: once(main),
      a: once((context) => {
        context.result.push(context.input);
        return Promise.resolve();
      }),
      b: once(() => Promise.resolve(), true),
      c: once(() => Promise.resolve()),
    },
    ...changes,
  });
}
export const options = () => ({ input: 4 });
export const gate = () => Promise.withResolvers<void>();
export function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true })
  );
}
export function leaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? (error.errors as unknown[]).flatMap(leaves) : [error];
}
