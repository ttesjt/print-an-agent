import type {
  WorkflowContext,
  StepDefinitions,
  StepExecutor,
  StepOverrides,
  ResolvedStepRegistry,
} from '../../contracts/index.js';

export interface WorkflowInputs<TInput, TResources> {
  readonly input: TInput;
  /** Assembly-bound capabilities, shared across runs without transferring resource ownership. */
  readonly resources: TResources;
}

export type WorkflowDecision =
  | Readonly<{ status: 'run' }>
  | Readonly<{ status: 'skip'; reason: string }>;

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

/** Assembly snapshot owned by the Workflow feature, not a package-level contract. */
export interface PreparedWorkflow<N extends string, I, S, R, O> {
  readonly name: string;
  readonly definition: WorkflowDefinition<N, I, S, R, O>;
  readonly steps: ResolvedStepRegistry<N, WorkflowContext<N, S, R>>;
  readonly executor: StepExecutor<N, WorkflowContext<N, S, R>>;
}
