import type {
  AgentLoopRequest,
  AgentLoopRuntime,
  ModelMessage,
  ProviderModelReference,
  ResolvedExecutionTarget,
  UserModelMessage,
} from '@ta-agent/base-model';
import type { ActiveSessionTurn, SessionPort, SessionReference } from '@ta-agent/base-session';
import type { BaseAgentContext, BaseWorkflowContext } from '@ta-agent/base-workflow';
import type { RequestStepName } from '../workflow/names.js';
import type {
  AgentRequestInput,
  AgentResponse,
  InstructionContributor,
  OutputSink,
  RequestPolicy,
  ValidatedAgentRequest,
} from '../contracts.js';

export interface RequestRuntimeResources {
  readonly session: SessionPort;
  readonly modelRuntime: AgentLoopRuntime;
  readonly modelReference: ProviderModelReference;
  readonly instructionContributors: readonly InstructionContributor[];
  readonly createOutputSink: () => OutputSink;
  readonly clock: () => number;
}

export type RequestAgentContext = BaseAgentContext<AgentRequestInput, AgentResponse>;

export interface DefaultRequestWorkflowContext extends BaseWorkflowContext<
  RequestStepName,
  RequestAgentContext,
  AgentResponse
> {
  readonly resources: RequestRuntimeResources;
  readonly policy: RequestPolicy;
  request?: ValidatedAgentRequest;
  session?: SessionReference;
  turn?: ActiveSessionTurn;
  target?: ResolvedExecutionTarget;
  instructions?: string;
  history?: readonly ModelMessage[];
  tools?: readonly [];
  userMessage?: UserModelMessage;
  modelRequest?: AgentLoopRequest;
  response?: AgentResponse;
}
