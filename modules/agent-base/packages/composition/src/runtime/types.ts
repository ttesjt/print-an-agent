import type {
  ActorCatalogPort,
  ActorDefinitionInput,
  ActorId,
  ResponsibilityCatalogPort,
  ResponsibilityDefinitionInput,
} from '@ta-agent/base-actor';
import type { AgentIdentityInput } from '@ta-agent/base-identity';
import type { AgentTraceRuntimeOptions } from '@ta-agent/base-observability';
import type {
  CompactableSessionPort,
  SessionCompactionAgentRunContext,
  SessionCompactionCondition,
  SessionCompactionPolicy,
  SessionCompactionStepName,
  SessionCompactionWorkflowContext,
} from '@ta-agent/base-session';
import type {
  DefaultRequestWorkflowContext,
  InstructionContributor,
  OutputSink,
  RequestAgentRunContext,
  RequestPolicy,
  RequestJournalPort,
} from '@ta-agent/base-request';
import type { ToolExecutionPolicy, ToolRegistry } from '@ta-agent/base-tool';
import type { AgentWorkflow } from '@ta-agent/base-runtime';
import type { StepOverrides } from '@ta-agent/workflow-core';
import type { RequestStepName } from '@ta-agent/base-request';
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

export interface ComposeAgentOptions {
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
