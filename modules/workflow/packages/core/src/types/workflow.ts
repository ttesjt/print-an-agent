import type { WorkflowContext, WorkflowInputs } from './context.js';
import type { WorkflowFailureClassifier, WorkflowObserver } from './events.js';
import type { StepDefinitions, StepExecutor, StepOverrides } from './step.js';

export type WorkflowDecision =
  | Readonly<{ status: 'run' }>
  | Readonly<{ status: 'skip'; reason: string }>;
export const RUN_WORKFLOW: WorkflowDecision = Object.freeze({ status: 'run' });
export function skipWorkflow(reason: string): WorkflowDecision {
  return Object.freeze({ status: 'skip', reason });
}

export interface WorkflowRunOptions<TInput> {
  readonly input: TInput;
  readonly signal?: AbortSignal;
  readonly parentRunId?: string;
  readonly onEvent?: WorkflowObserver;
  /** Used only for observed failure events. Throws and invalid return values omit the code. */
  readonly classifyFailure?: WorkflowFailureClassifier;
}
export interface WorkflowLifecycle<C> {
  readonly onSuccess?: (context: C) => void | Promise<void>;
  readonly onError?: (context: C, error: unknown) => void | Promise<void>;
  readonly onFinally?: (context: C) => void | Promise<void>;
}

export interface WorkflowDefinition<TStepName extends string, TInput, TState, TResources, TResult> {
  readonly name: string;
  /** Bound during assembly and borrowed by every run; Core never closes these capabilities. */
  readonly resources: TResources;
  readonly entryStep: TStepName;
  readonly stepDefinitions: StepDefinitions<
    TStepName,
    WorkflowContext<TStepName, TInput, TState, TResources, TResult>
  >;
  readonly stepOverrides?: StepOverrides<
    TStepName,
    WorkflowContext<TStepName, TInput, TState, TResources, TResult>
  >;
  /** Pure synchronous factories; neither acquires resources. */
  readonly createResult: (inputs: WorkflowInputs<TInput, TResources>) => TResult;
  readonly createState: (inputs: WorkflowInputs<TInput, TResources>) => TState;
  readonly condition?: (
    inputs: WorkflowInputs<TInput, TResources> & { readonly signal: AbortSignal }
  ) => WorkflowDecision | Promise<WorkflowDecision>;
  readonly lifecycle?: WorkflowLifecycle<
    WorkflowContext<TStepName, TInput, TState, TResources, TResult>
  >;
  readonly executeStep?: StepExecutor<
    TStepName,
    WorkflowContext<TStepName, TInput, TState, TResources, TResult>
  >;
  readonly createRunId?: () => string;
}

export interface RunnableWorkflow<TInput, TResult> {
  readonly name: string;
  run(options: WorkflowRunOptions<TInput>): Promise<TResult>;
}
