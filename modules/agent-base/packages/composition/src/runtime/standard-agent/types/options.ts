import type { AgentActorCatalogPort, ResponsibilityCatalogPort } from '@print-an-agent/agent-actor';
import type { AgentIdentityInput } from '@print-an-agent/base-identity-config/identity';
import type { AgentTraceRuntimeOptions } from '@print-an-agent/base-observability';
import type {
  DefaultRequestWorkflowContext,
  InstructionContributor,
  OutputSink,
  RequestJournalPort,
  RequestPolicy,
  RequestStepName,
} from '@print-an-agent/base-request';
import type { AgentWorkflow } from '@print-an-agent/base-runtime';
import type {
  CompactableSessionPort,
  SessionCompactionCondition,
  SessionCompactionPolicy,
  SessionCompactionStepName,
  SessionCompactionWorkflowContext,
} from '@print-an-agent/base-session';
import type { ToolExecutionPolicy, ToolRegistry } from '@print-an-agent/base-tool';
import type { ActorId, TextTokenInput, TokenCounter } from '@print-an-agent/model-invocation-core';
import type { StepOverrides } from '@print-an-agent/workflow-core';
import type { RequestAgentRunContext, SessionCompactionAgentRunContext } from './run-context.js';

export interface ComposeAgentOptions {
  readonly contextMemory?: import('@print-an-agent/base-request').RequestContextMemory;
  readonly identity: AgentIdentityInput;
  readonly actorCatalog: AgentActorCatalogPort;
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
