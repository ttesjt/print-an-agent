import type { AgentIdentity, AgentIdentityInput } from '@ta-agent/base-identity';
import type { AgentLoopRuntime, ProviderModelReference } from '@ta-agent/base-model';
import type { AgentTraceEventSink, AgentTraceRuntimeOptions } from '@ta-agent/base-observability';
import type { PiFauxRuntimeInspection, PiFauxRuntimeOptions } from '@ta-agent/base-pi';
import type {
  CompactSessionInput,
  NavigateSessionInput,
  NavigableCompactableSessionPort,
  SessionCompactionAgentContext,
  SessionCompactionCondition,
  SessionCompactionOutcome,
  SessionCompactionPolicy,
  SessionCompactionRuntime,
  SessionCompactionStepName,
  SessionCompactionWorkflowContext,
  SessionCompactionWorkflowName,
  SessionNavigationAgentContext,
  SessionNavigationOutcome,
  SessionNavigationStepName,
  SessionNavigationWorkflowContext,
  SessionNavigationWorkflowName,
} from '@ta-agent/base-session';
import type {
  AgentRequestInput,
  AgentResponse,
  DefaultRequestWorkflowContext,
  InstructionContributor,
  OutputSink,
  RequestAgentContext,
  RequestPolicy,
  RequestJournalPort,
} from '@ta-agent/base-request';
import type { ToolExecutionPolicy, ToolPermissionPolicy, ToolRegistry } from '@ta-agent/base-tool';
import type { AgentRunOptions, RunnableWorkflow, StepOverrides } from '@ta-agent/base-workflow';
import type { RequestStepName, RequestWorkflowName } from '@ta-agent/base-request';

export interface AssembleAgentBaseOptions {
  readonly identity: AgentIdentityInput;
  readonly modelRuntime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly session?: NavigableCompactableSessionPort;
  readonly requestJournal?: RequestJournalPort;
  readonly instructionContributors?: readonly InstructionContributor[];
  readonly toolRegistry?: ToolRegistry;
  readonly toolPermissionPolicy?: ToolPermissionPolicy;
  readonly toolExecutionPolicy?: ToolExecutionPolicy;
  readonly createOutputSink?: () => OutputSink;
  readonly requestPolicy?: RequestPolicy;
  readonly stepOverrides?: StepOverrides<RequestStepName, DefaultRequestWorkflowContext>;
  readonly requestWorkflow?: RunnableWorkflow<RequestAgentContext>;
  readonly observability?: AgentTraceRuntimeOptions;
  readonly clock?: () => number;
  readonly createRunId?: () => string;
  readonly createWorkflowRunId?: () => string;
  readonly sessionCompactionRuntime?: SessionCompactionRuntime;
  readonly sessionCompactionPolicy?: SessionCompactionPolicy;
  readonly sessionCompactionInstructions?: string;
  readonly sessionCompactionCondition?: SessionCompactionCondition;
  readonly sessionCompactionStepOverrides?: StepOverrides<
    SessionCompactionStepName,
    SessionCompactionWorkflowContext
  >;
  readonly sessionCompactionWorkflow?: RunnableWorkflow<SessionCompactionAgentContext>;
  readonly createCompactionRunId?: () => string;
  readonly createCompactionWorkflowRunId?: () => string;
  readonly sessionNavigationStepOverrides?: StepOverrides<
    SessionNavigationStepName,
    SessionNavigationWorkflowContext
  >;
  readonly sessionNavigationWorkflow?: RunnableWorkflow<SessionNavigationAgentContext>;
  readonly createNavigationRunId?: () => string;
  readonly createNavigationWorkflowRunId?: () => string;
}

export type AgentBaseRunOptions = Omit<AgentRunOptions<RequestWorkflowName>, 'workflowPlan'>;
export type SessionCompactionRunOptions = Omit<
  AgentRunOptions<SessionCompactionWorkflowName>,
  'workflowPlan'
>;
export type SessionNavigationRunOptions = Omit<
  AgentRunOptions<SessionNavigationWorkflowName>,
  'workflowPlan'
>;

export interface AssembledAgentBase {
  readonly identity: AgentIdentity;
  readonly session: NavigableCompactableSessionPort;
  readonly requestJournal: RequestJournalPort;
  readonly modelRuntime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly requestPolicy: RequestPolicy;
  readonly toolRegistry: ToolRegistry;
  readonly toolPermissionPolicy: ToolPermissionPolicy;
  readonly toolExecutionPolicy: ToolExecutionPolicy;
  readonly traceSink: AgentTraceEventSink;
  run(input: AgentRequestInput, options?: AgentBaseRunOptions): Promise<AgentResponse>;
  compactSession(
    input: CompactSessionInput,
    options?: SessionCompactionRunOptions
  ): Promise<SessionCompactionOutcome>;
  navigateSession(
    input: NavigateSessionInput,
    options?: SessionNavigationRunOptions
  ): Promise<SessionNavigationOutcome>;
}

export interface CreatePiFauxAgentBaseOptions extends Omit<
  AssembleAgentBaseOptions,
  'modelRuntime' | 'modelReference' | 'requestWorkflow' | 'sessionCompactionRuntime'
> {
  readonly pi: PiFauxRuntimeOptions;
}

export interface PiFauxAgentBase extends AssembledAgentBase {
  inspectPi(): PiFauxRuntimeInspection;
}
