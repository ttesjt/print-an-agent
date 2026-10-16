export interface StepRunner<TStepName extends string> {
  readonly runStep: (name: TStepName) => Promise<void>;
  /** Cancels peers on failure and joins every child before rejecting. Always await this call. */
  readonly parallel: (names: readonly TStepName[]) => Promise<void>;
}

export interface WorkflowInputs<TInput, TResources> {
  readonly input: TInput;
  /** Assembly-bound capabilities, shared across runs without transferring resource ownership. */
  readonly resources: TResources;
}

export interface WorkflowContext<TStepName extends string, TInput, TState, TResources, TResult>
  extends WorkflowInputs<TInput, TResources>, StepRunner<TStepName> {
  readonly workflowName: string;
  readonly workflowRunId: string;
  readonly parentRunId: string | undefined;
  /** Effective signal for this execution scope, including enclosing parallel groups. */
  readonly signal: AbortSignal;
  readonly state: TState;
  result: TResult;
}
