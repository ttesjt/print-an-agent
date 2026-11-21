import type { ResolvedResponsibility } from '@print-an-agent/agent-actor';
import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import type { AgentTraceEmitter } from '@print-an-agent/base-observability';
import type {
  ActiveSessionTurn,
  ResolvedSessionReference,
  SessionTurnPresentation,
  SessionWriteAuthority,
} from '@print-an-agent/base-session';
import type { ToolPermissionPolicy, ToolRuntime } from '@print-an-agent/base-tool';
import type {
  ActorInteractionRequest,
  ModelMessage,
  UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { WorkflowContext } from '@print-an-agent/workflow-core';
import type { RequestInteractionState } from '../../interaction/index.js';
import type { RequestPolicy } from '../../policy/index.js';
import type { ActiveRequestJournalEntry, RequestJournalEntry } from '../replay/index.js';
import type { RequestStepName } from '../workflow/index.js';
import type { AgentRequestInput, ValidatedAgentRequest } from './input.js';
import type { RequestMemoryRun } from './memory.js';
import type { AgentResponse } from './output.js';
import type { CapturedReasoningPresentation } from './presentation.js';
import type { RequestRuntimeResources } from './resources.js';

/** Business input and optional invocation-local tracing; execution is supplied by Core. */
export interface RequestWorkflowInput {
  readonly agentId: AgentId;
  readonly requestId: string;
  readonly requestInput: AgentRequestInput;
  readonly traceEmitter?: AgentTraceEmitter;
}

export type DefaultRequestWorkflowContext = WorkflowContext<
  RequestStepName,
  RequestWorkflowState,
  RequestRuntimeResources & { readonly policy: RequestPolicy }
>;

export interface RequestWorkflowState extends RequestWorkflowInput {
  contextMemory?: RequestMemoryRun;
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
  toolPermissionPolicy?: ToolPermissionPolicy;
  userMessage?: UserModelMessage;
  modelRequest?: ActorInteractionRequest;
  interaction?: RequestInteractionState;
  /** Run-local display data; never part of modelRequest, response, or trace. */
  capturedReasoning?: CapturedReasoningPresentation;
  turnPresentation?: SessionTurnPresentation;
  response?: AgentResponse;
  completedResponse?: AgentResponse;
  modelTurnCount?: number;
  outputCharacterCount?: number;
  replayedOutput?: boolean;
}
