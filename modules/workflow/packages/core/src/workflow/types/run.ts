import type { WorkflowObserver, WorkflowFailureClassifier } from '../../execution/index.js';

export interface WorkflowRunOptions<TInput> {
  readonly input: TInput;
  readonly signal?: AbortSignal;
  readonly parentRunId?: string;
  readonly onEvent?: WorkflowObserver;
  /** Used only for observed failure events. Throws and invalid return values omit the code. */
  readonly classifyFailure?: WorkflowFailureClassifier;
}

export interface RunnableWorkflow<TInput, TResult> {
  readonly name: string;
  run(options: WorkflowRunOptions<TInput>): Promise<TResult>;
}
