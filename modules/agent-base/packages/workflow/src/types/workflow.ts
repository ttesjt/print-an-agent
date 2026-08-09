import type { AnyAgentRunContext, BaseWorkflowContext, StepRunner } from './context.js';
import type { StepDefinitions, StepExecutor, StepName, StepOverrides } from './step.js';

export type WorkflowName = string;

export type WorkflowDecision =
  | Readonly<{ status: 'run' }>
  | Readonly<{ status: 'skip'; reason: string }>;

export type WorkflowCondition<C extends AnyAgentRunContext> = (
  agentRunContext: C
) => Promise<WorkflowDecision>;

export interface WorkflowLifecycle<WC> {
  readonly onSuccess?: (context: WC) => Promise<void>;
  readonly onError?: (context: WC, error: unknown) => Promise<void>;
  readonly onFinally?: (context: WC) => Promise<void>;
}

export interface WorkflowContextFactoryInput<
  TStepName extends StepName,
  C extends AnyAgentRunContext,
> extends StepRunner<TStepName> {
  readonly workflowName: WorkflowName;
  readonly workflowRunId: string;
  readonly agentRunContext: C;
  readonly signal: AbortSignal;
}

export type WorkflowContextFactory<
  TStepName extends StepName,
  C extends AnyAgentRunContext,
  WC extends BaseWorkflowContext<TStepName, C>,
> = (input: WorkflowContextFactoryInput<TStepName, C>) => WC;

export interface WorkflowDefinition<
  TStepName extends StepName,
  C extends AnyAgentRunContext,
  WC extends BaseWorkflowContext<TStepName, C, TResult>,
  TResult,
> {
  readonly name: WorkflowName;
  readonly entryStep: TStepName;
  readonly stepDefinitions: StepDefinitions<TStepName, WC>;
  readonly stepOverrides?: StepOverrides<TStepName, WC>;
  readonly createContext: WorkflowContextFactory<TStepName, C, WC>;
  readonly condition?: WorkflowCondition<C>;
  readonly lifecycle?: WorkflowLifecycle<WC>;
  readonly applyResult: (agentRunContext: C, result: TResult) => Promise<void>;
  readonly executeStep?: StepExecutor<TStepName, WC>;
  readonly createRunId?: () => string;
}

export interface CompletedWorkflowRun<C extends AnyAgentRunContext, TResult> {
  readonly status: 'completed';
  readonly workflowName: WorkflowName;
  readonly workflowRunId: string;
  readonly result: TResult;
  readonly applyTo: (agentRunContext: C) => Promise<void>;
}

export interface SkippedWorkflowRun {
  readonly status: 'skipped';
  readonly workflowName: WorkflowName;
  readonly reason: string;
}

export type WorkflowRunOutcome<C extends AnyAgentRunContext, TResult> =
  | CompletedWorkflowRun<C, TResult>
  | SkippedWorkflowRun;

export interface RunnableWorkflow<C extends AnyAgentRunContext> {
  readonly name: WorkflowName;
  run(agentRunContext: C): Promise<WorkflowRunOutcome<C, unknown>>;
}
