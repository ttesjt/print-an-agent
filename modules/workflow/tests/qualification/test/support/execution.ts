import {
  Workflow,
  type Step,
  type WorkflowContext,
  type WorkflowDefinition,
  type StepOverrides,
} from '@ta-agent/workflow-core';

export type Names = 'entry' | 'group' | 'left' | 'right' | 'other' | 'after';
export type Context = WorkflowContext<Names, void, { visited: string[] }, void, string[]>;
export function execution(
  entry: Step<Context>,
  overrides: StepOverrides<Names, Context> = {},
  lifecycle?: WorkflowDefinition<Names, void, { visited: string[] }, void, string[]>['lifecycle']
) {
  const leaf = {
    step: () => Promise.resolve(),
    skippable: false,
    cardinality: 'at-most-once',
  } as const;
  return new Workflow<Names, void, { visited: string[] }, void, string[]>({
    name: 'qualification',
    resources: undefined,
    entryStep: 'entry',
    createState: () => ({ visited: [] }),
    createResult: () => [],
    stepDefinitions: {
      entry: { ...leaf, step: entry },
      group: leaf,
      left: leaf,
      right: leaf,
      other: leaf,
      after: leaf,
    },
    stepOverrides: overrides,
    ...(lifecycle === undefined ? {} : { lifecycle }),
  });
}
export const runOptions = { input: undefined };
export const gate = () => Promise.withResolvers<void>();
export function onAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true })
  );
}
export function causes(error: unknown): unknown[] {
  return error instanceof AggregateError ? (error.errors as unknown[]).flatMap(causes) : [error];
}
