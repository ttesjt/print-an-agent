import type { ResolvedResponsibility, ResponsibilityRouter } from '@ta-agent/base-actor';
import type { ActorInteractionRequest } from '@ta-agent/model-invocation-core';
import type { ModelMessage, UserModelMessage } from '@ta-agent/model-invocation-core';
import type {
  ActiveSessionTurn,
  ResolvedSessionReference,
  SessionPort,
  SessionTurnPresentation,
  SessionWriteAuthority,
} from '@ta-agent/base-session';
import type { ToolExecutionPolicy, ToolName, ToolRegistry, ToolRuntime } from '@ta-agent/base-tool';
import type { BaseAgentRunContext } from '@ta-agent/base-runtime';
import type { WorkflowContext } from '@ta-agent/workflow-core';
import type { RequestStepName } from '../workflow/names.js';
import type { RequestInteractionState } from '../interaction/state.js';
import type { CapturedReasoningPresentation } from '../interaction/presentation.js';
import type {
  AgentRequestInput,
  AgentResponse,
  InstructionContributor,
  OutputSink,
  RequestPolicy,
  ValidatedAgentRequest,
} from '../contracts.js';
import type {
  ActiveRequestJournalEntry,
  RequestJournalEntry,
  RequestJournalPort,
} from '../replay/contracts.js';

export interface RequestRuntimeResources {
  readonly session: SessionPort;
  readonly requestJournal: RequestJournalPort;
  readonly responsibilities: ResponsibilityRouter;
  readonly instructionContributors: readonly InstructionContributor[];
  readonly toolRegistry: ToolRegistry;
  readonly productToolAllowList: readonly ToolName[];
  readonly runtimeToolAllowList: readonly ToolName[];
  readonly toolExecutionPolicy: ToolExecutionPolicy;
  readonly createOutputSink: () => OutputSink;
  readonly clock: () => number;
}

export type RequestAgentRunContext = BaseAgentRunContext<AgentRequestInput, AgentResponse>;

export type DefaultRequestWorkflowContext = WorkflowContext<
  RequestStepName,
  RequestAgentRunContext,
  RequestWorkflowState,
  RequestRuntimeResources & { readonly policy: RequestPolicy },
  AgentResponse | undefined
>;

export interface RequestWorkflowState {
  request?: ValidatedAgentRequest;
  session?: ResolvedSessionReference & SessionWriteAuthority;
  /** True only after all owned persistent work and output finalization settled successfully. */
  executionSettled?: boolean;
  turn?: ActiveSessionTurn;
  requestJournalEntry?: RequestJournalEntry;
  ownedRequestJournalClaim?: ActiveRequestJournalEntry;
  responsibility?: ResolvedResponsibility;
  instructions?: string;
  history?: readonly ModelMessage[];
  tools?: ToolRuntime;
  userMessage?: UserModelMessage;
  modelRequest?: ActorInteractionRequest;
  interaction?: RequestInteractionState;
  /** Run-local display data; never part of modelRequest, response, or trace. */
  capturedReasoning?: CapturedReasoningPresentation;
  turnPresentation?: SessionTurnPresentation;
  response?: AgentResponse;
  modelTurnCount?: number;
  outputCharacterCount?: number;
  replayedOutput?: boolean;
}
