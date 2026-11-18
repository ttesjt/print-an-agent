import type {
  ActorCatalogPort,
  ActorDefinitionInput,
  ResponsibilityCatalogPort,
  ResponsibilityDefinitionInput,
} from '@print-an-agent/base-actor';
import type { ActorId, TokenCounter, TextTokenInput } from '@print-an-agent/model-invocation-core';
import type { AgentIdentityInput } from '@print-an-agent/base-identity';
import type { AgentTraceRuntimeOptions } from '@print-an-agent/base-observability';
import type {
  CompactableSessionPort,
  CompactSessionInput,
  SessionCompactionOutcome,
  SessionCompactionCondition,
  SessionCompactionPolicy,
  SessionCompactionStepName,
  SessionCompactionWorkflowContext,
} from '@print-an-agent/base-session';
import type {
  AgentRequestInput,
  AgentResponse,
  DefaultRequestWorkflowContext,
  InstructionContributor,
  OutputSink,
  RequestPolicy,
  RequestJournalPort,
} from '@print-an-agent/base-request';
import type { ToolExecutionPolicy, ToolRegistry } from '@print-an-agent/base-tool';
import type { AgentWorkflow, BaseAgentRunContext } from '@print-an-agent/base-runtime';
import type { StepOverrides } from '@print-an-agent/workflow-core';
import type { RequestStepName } from '@print-an-agent/base-request';
import type { AgentAPI } from './agent-api.js';
import type {
  DeterministicProviderInspection,
  DeterministicProviderRuntimeOptions,
} from './deterministic-provider-contracts.js';
import type {
  ProviderReadiness,
  ProviderRuntimeInspection,
  ProviderRuntimeOptions,
} from './provider-contracts.js';

export type RequestAgentRunContext = BaseAgentRunContext<AgentRequestInput, AgentResponse>;

export type SessionCompactionAgentRunContext = BaseAgentRunContext<
  CompactSessionInput,
  SessionCompactionOutcome
>;

export interface ComposeAgentOptions {
  readonly contextMemory?: import('@print-an-agent/base-request').RequestContextMemory;
  readonly identity: AgentIdentityInput;
  readonly actorCatalog: ActorCatalogPort;
  readonly responsibilityCatalog: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
  readonly session?: CompactableSessionPort;
  readonly requestJournal?: RequestJournalPort;
  readonly instructionContributors?: readonly InstructionContributor[];
  readonly toolRegistry?: ToolRegistry;
  readonly productToolAllowList?: readonly string[];
  readonly runtimeToolAllowList?: readonly string[];
  readonly toolExecutionPolicy?: ToolExecutionPolicy;
  readonly createOutputSink?: () => OutputSink;
  readonly requestPolicy?: RequestPolicy;
  readonly stepOverrides?: StepOverrides<RequestStepName, DefaultRequestWorkflowContext>;
  readonly requestWorkflow?: AgentWorkflow<RequestAgentRunContext>;
  readonly observability?: AgentTraceRuntimeOptions;
  readonly clock?: () => number;
  readonly createRunId?: () => string;
  readonly createWorkflowRunId?: () => string;
  readonly sessionCompactionPolicy?: SessionCompactionPolicy;
  /** Host-owned executable capability; never inferred from provider/model names. */
  readonly sessionCompactionTokenCounter?: TokenCounter<TextTokenInput>;
  readonly sessionCompactionInstructions?: string;
  readonly sessionCompactionCondition?: SessionCompactionCondition;
  readonly sessionCompactionStepOverrides?: StepOverrides<
    SessionCompactionStepName,
    SessionCompactionWorkflowContext
  >;
  readonly sessionCompactionWorkflow?: AgentWorkflow<SessionCompactionAgentRunContext>;
  readonly createCompactionRunId?: () => string;
  readonly createCompactionWorkflowRunId?: () => string;
}

export interface CreateDeterministicAgentAPIOptions extends Omit<
  ComposeAgentOptions,
  'actorCatalog' | 'responsibilityCatalog' | 'mainActorId' | 'requestWorkflow'
> {
  readonly provider: DeterministicProviderRuntimeOptions;
  readonly actorCatalog?: ActorCatalogPort;
  readonly responsibilityCatalog?: ResponsibilityCatalogPort;
  readonly mainActorId?: ActorId;
  readonly mainActor?: Omit<ActorDefinitionInput, 'id' | 'engineId'>;
  readonly responsibilities?: readonly ResponsibilityDefinitionInput[];
}

export interface DeterministicAgentAPI extends AgentAPI {
  inspectDeterministicProvider(): DeterministicProviderInspection;
}

export interface CreateProviderAgentAPIOptions extends Omit<
  ComposeAgentOptions,
  'actorCatalog' | 'responsibilityCatalog' | 'mainActorId'
> {
  readonly provider: ProviderRuntimeOptions;
  readonly mainActor?: Omit<ActorDefinitionInput, 'id' | 'engineId'>;
  readonly responsibilities?: readonly ResponsibilityDefinitionInput[];
}

export interface ProviderAgentAPI extends AgentAPI {
  inspectProvider(): ProviderRuntimeInspection;
  checkProviderReadiness(options?: Readonly<{ signal?: AbortSignal }>): Promise<ProviderReadiness>;
}
