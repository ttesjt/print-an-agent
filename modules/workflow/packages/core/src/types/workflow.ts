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
  /**
   * Explicit capabilities bound at assembly and borrowed by every Run, not a composition Registry.
   * Their shape is consumer-defined and may include narrow on-demand capability methods.
   * Workflow is execution/implementation, not an application Service; Core never closes resources.
   */
  readonly resources: TResources;
  readonly entryStep: TStepName;
  readonly stepDefinitions: StepDefinitions<
    TStepName,
    WorkflowContext<TStepName, TState, TResources>
  >;
  readonly stepOverrides?: StepOverrides<TStepName, WorkflowContext<TStepName, TState, TResources>>;
  /** Synchronously derives the return value after Steps and onSuccess. Treat state as read-only. */
  readonly createResult: (state: TState) => TResult;
  /** Required when the condition skips. Synchronously derives a value without creating state. */
  readonly createSkippedResult?: (skip: {
    readonly input: TInput;
    readonly reason: string;
  }) => TResult;
  /** Converts input to run-local data with a consumer-defined shape exposed to Steps and hooks. */
  readonly createState: (inputs: WorkflowInputs<TInput, TResources>) => TState;
  readonly condition?: (
    inputs: WorkflowInputs<TInput, TResources> & { readonly signal: AbortSignal }
  ) => WorkflowDecision | Promise<WorkflowDecision>;
  readonly lifecycle?: WorkflowLifecycle<WorkflowContext<TStepName, TState, TResources>>;
  readonly executeStep?: StepExecutor<TStepName, WorkflowContext<TStepName, TState, TResources>>;
  readonly createRunId?: () => string;
}

export interface RunnableWorkflow<TInput, TResult> {
  readonly name: string;
  run(options: WorkflowRunOptions<TInput>): Promise<TResult>;
}
