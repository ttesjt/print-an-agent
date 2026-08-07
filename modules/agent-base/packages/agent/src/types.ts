import type { AgentIdentity, AgentIdentityInput } from '@ta-agent/base-identity';
import type { AgentLoopRuntime, ProviderModelReference } from '@ta-agent/base-model';
import type { PiFauxRuntimeInspection, PiFauxRuntimeOptions } from '@ta-agent/base-pi';
import type {
  AgentRequestInput,
  AgentResponse,
  DefaultRequestWorkflowContext,
  InstructionContributor,
  OutputSink,
  RequestAgentContext,
  RequestPolicy,
} from '@ta-agent/base-request';
import type { SessionPort } from '@ta-agent/base-session';
import type { ToolExecutionPolicy, ToolPermissionPolicy, ToolRegistry } from '@ta-agent/base-tool';
import type { AgentRunOptions, RunnableWorkflow, StepOverrides } from '@ta-agent/base-workflow';
import type { RequestStepName, RequestWorkflowName } from '@ta-agent/base-request';

export interface AssembleAgentBaseOptions {
  readonly identity: AgentIdentityInput;
  readonly modelRuntime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly session?: SessionPort;
  readonly instructionContributors?: readonly InstructionContributor[];
  readonly toolRegistry?: ToolRegistry;
  readonly toolPermissionPolicy?: ToolPermissionPolicy;
  readonly toolExecutionPolicy?: ToolExecutionPolicy;
  readonly createOutputSink?: () => OutputSink;
  readonly requestPolicy?: RequestPolicy;
  readonly stepOverrides?: StepOverrides<RequestStepName, DefaultRequestWorkflowContext>;
  readonly requestWorkflow?: RunnableWorkflow<RequestAgentContext>;
  readonly clock?: () => number;
  readonly createRunId?: () => string;
  readonly createWorkflowRunId?: () => string;
}

export type AgentBaseRunOptions = Omit<AgentRunOptions<RequestWorkflowName>, 'workflowPlan'>;

export interface AssembledAgentBase {
  readonly identity: AgentIdentity;
  readonly session: SessionPort;
  readonly modelRuntime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly requestPolicy: RequestPolicy;
  readonly toolRegistry: ToolRegistry;
  readonly toolPermissionPolicy: ToolPermissionPolicy;
  readonly toolExecutionPolicy: ToolExecutionPolicy;
  run(input: AgentRequestInput, options?: AgentBaseRunOptions): Promise<AgentResponse>;
}

export interface CreatePiFauxAgentBaseOptions extends Omit<
  AssembleAgentBaseOptions,
  'modelRuntime' | 'modelReference' | 'requestWorkflow'
> {
  readonly pi: PiFauxRuntimeOptions;
}

export interface PiFauxAgentBase extends AssembledAgentBase {
  inspectPi(): PiFauxRuntimeInspection;
}
