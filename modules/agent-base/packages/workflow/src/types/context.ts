import type { AgentIdentity } from '@ta-agent/base-identity';
import type { StepName } from './step.js';
import type { WorkflowName } from './workflow.js';

export interface StepRunner<TStepName extends StepName = StepName> {
  readonly runStep: (stepName: TStepName) => Promise<void>;
}

export interface BaseAgentContext<TInput = unknown, TOutput = unknown> {
  readonly identity: AgentIdentity;
  readonly runId: string;
  readonly input: TInput;
  output?: TOutput;
  readonly signal: AbortSignal;
}

export type AnyAgentContext = BaseAgentContext<unknown, unknown>;

export interface BaseWorkflowContext<
  TStepName extends StepName = StepName,
  TAgentContext extends AnyAgentContext = AnyAgentContext,
  TResult = unknown,
> extends StepRunner<TStepName> {
  readonly workflowName: WorkflowName;
  readonly workflowRunId: string;
  readonly agentContext: TAgentContext;
  readonly signal: AbortSignal;
  result?: TResult;
}

export type AnyWorkflowContext = BaseWorkflowContext<never, AnyAgentContext, unknown>;
