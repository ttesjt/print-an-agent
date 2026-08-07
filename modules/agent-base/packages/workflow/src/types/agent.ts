import type { AgentId, AgentIdentity } from '@ta-agent/base-identity';
import type { AgentTraceEmitter, AgentTraceRuntimeOptions } from '@ta-agent/base-observability';
import type { BaseAgentContext } from './context.js';
import type { WorkflowName } from './workflow.js';
import type { WorkflowDefinitions, WorkflowOverrides } from './workflow-registry.js';

export interface AgentContextFactoryInput<TInput, TConfig, TResources> {
  readonly identity: AgentIdentity;
  readonly runId: string;
  readonly input: TInput;
  readonly signal: AbortSignal;
  readonly config: TConfig;
  readonly resources: TResources;
  readonly traceEmitter: AgentTraceEmitter;
}

export type AgentContextFactory<TInput, TConfig, TResources, C extends BaseAgentContext<TInput>> = (
  input: AgentContextFactoryInput<TInput, TConfig, TResources>
) => C;

export interface AgentDefinition<
  TWorkflowName extends WorkflowName,
  TInput,
  TOutput,
  TConfig,
  TResources,
  C extends BaseAgentContext<TInput, TOutput>,
> {
  readonly identity: AgentIdentity;
  readonly config: TConfig;
  readonly resources: TResources;
  readonly workflowPlan: readonly TWorkflowName[];
  readonly workflowDefinitions: WorkflowDefinitions<TWorkflowName, C>;
  readonly workflowOverrides?: WorkflowOverrides<TWorkflowName, C>;
  readonly createContext: AgentContextFactory<TInput, TConfig, TResources, C>;
  readonly observability?: AgentTraceRuntimeOptions;
  readonly createRunId?: () => string;
}

export interface AgentRunOptions<TWorkflowName extends WorkflowName> {
  readonly signal?: AbortSignal;
  readonly workflowPlan?: readonly TWorkflowName[];
}

export interface RunnableAgent<TWorkflowName extends WorkflowName, TInput, TOutput> {
  readonly identity: AgentIdentity;
  readonly agentId: AgentId;
  run(input: TInput, options?: AgentRunOptions<TWorkflowName>): Promise<TOutput>;
  runPlan(
    input: TInput,
    workflowPlan: readonly TWorkflowName[],
    options?: Omit<AgentRunOptions<TWorkflowName>, 'workflowPlan'>
  ): Promise<TOutput>;
  runWorkflow(
    input: TInput,
    workflowName: TWorkflowName,
    options?: Omit<AgentRunOptions<TWorkflowName>, 'workflowPlan'>
  ): Promise<TOutput>;
}
