import type {
  ActorCatalogPort,
  ActorDefinitionInput,
  ActorId,
  ResponsibilityCatalogPort,
  ResponsibilityDefinitionInput,
  ResponsibilityRouter,
} from '@ta-agent/base-actor';
import type { AgentIdentity, AgentIdentityInput } from '@ta-agent/base-identity';
import type { AgentTraceEventSink, AgentTraceRuntimeOptions } from '@ta-agent/base-observability';
import type {
  PiFauxRuntimeInspection,
  PiFauxRuntimeOptions,
  PiProviderReadiness,
  PiProviderRuntimeInspection,
  PiProviderRuntimeOptions,
} from '@ta-agent/base-pi';
import type {
  CompactSessionInput,
  NavigateSessionInput,
  NavigableCompactableSessionPort,
  SessionCompactionAgentContext,
  SessionCompactionCondition,
  SessionCompactionOutcome,
  SessionCompactionPolicy,
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
import type { ToolExecutionPolicy, ToolName, ToolRegistry } from '@ta-agent/base-tool';
import type { AgentRunOptions, RunnableWorkflow, StepOverrides } from '@ta-agent/base-workflow';
import type { RequestStepName, RequestWorkflowName } from '@ta-agent/base-request';

export interface AssembleAgentBaseOptions {
  readonly identity: AgentIdentityInput;
  readonly actorCatalog: ActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
  readonly session?: NavigableCompactableSessionPort;
  readonly requestJournal?: RequestJournalPort;
  readonly instructionContributors?: readonly InstructionContributor[];
  readonly toolRegistry?: ToolRegistry;
  readonly productToolAllowList?: readonly string[];
  readonly runtimeToolAllowList?: readonly string[];
  readonly toolExecutionPolicy?: ToolExecutionPolicy;
  readonly createOutputSink?: () => OutputSink;
  readonly requestPolicy?: RequestPolicy;
  readonly stepOverrides?: StepOverrides<RequestStepName, DefaultRequestWorkflowContext>;
  readonly requestWorkflow?: RunnableWorkflow<RequestAgentContext>;
  readonly observability?: AgentTraceRuntimeOptions;
  readonly clock?: () => number;
  readonly createRunId?: () => string;
  readonly createWorkflowRunId?: () => string;
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
  readonly actorCatalog: ActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  readonly responsibilityRouter: ResponsibilityRouter;
  readonly mainActorId: ActorId;
  readonly requestPolicy: RequestPolicy;
  readonly toolRegistry: ToolRegistry;
  readonly productToolAllowList: readonly ToolName[];
  readonly runtimeToolAllowList: readonly ToolName[];
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
  'actorCatalog' | 'responsibilityCatalog' | 'mainActorId' | 'requestWorkflow'
> {
  readonly pi: PiFauxRuntimeOptions;
  readonly actorCatalog?: ActorCatalogPort;
  readonly responsibilityCatalog?: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
  readonly mainActor?: Omit<ActorDefinitionInput, 'id' | 'engineId'>;
  readonly responsibilities?: readonly ResponsibilityDefinitionInput[];
}

export interface PiFauxAgentBase extends AssembledAgentBase {
  inspectPi(): PiFauxRuntimeInspection;
}

export interface CreatePiAgentBaseOptions extends Omit<
  AssembleAgentBaseOptions,
  'actorCatalog' | 'responsibilityCatalog' | 'mainActorId'
> {
  readonly pi: PiProviderRuntimeOptions;
  readonly mainActor?: Omit<ActorDefinitionInput, 'id' | 'engineId'>;
  readonly responsibilities?: readonly ResponsibilityDefinitionInput[];
}

export interface PiAgentBase extends AssembledAgentBase {
  inspectPiProvider(): PiProviderRuntimeInspection;
  checkPiProviderReadiness(
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<PiProviderReadiness>;
}
