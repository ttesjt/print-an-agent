import type {
  ToolExecutionPolicy,
  ToolPermissionPolicy,
  ToolPermissionPolicyInput,
  ToolRegistry,
  ToolRunInspection,
  ToolRuntime,
} from '@print-an-agent/base-tool';
import type {
  ActorDirectResult,
  ActorInteractionRequest,
  InteractionCapability,
  ModelMessage,
  UserModelMessage,
} from '@print-an-agent/model-invocation-core';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { SessionlessRequestStepName } from '../../names.js';
import type { SessionlessRequestInput } from '../../types/input.js';
import type { SessionlessPolicy } from '../../types/policy.js';
import type { BoundSessionlessResources, SessionlessResources } from '../../types/resources.js';
import type { SessionlessState } from '../../types/state.js';

export interface SessionlessInteractionPolicy extends SessionlessPolicy {
  readonly maxModelTurns: number;
}

export interface SessionlessInteractionResources extends Omit<SessionlessResources, 'policy'> {
  readonly policy?: Partial<SessionlessInteractionPolicy>;
  readonly tools?: {
    readonly registry: ToolRegistry;
    /** Core Actors have no permission authority; omission is deny-all. */
    readonly permissionPolicy?: ToolPermissionPolicyInput;
    readonly executionPolicy?: ToolExecutionPolicy;
  };
}

export interface BoundSessionlessInteractionResources extends Omit<
  BoundSessionlessResources,
  'policy'
> {
  readonly policy: SessionlessInteractionPolicy;
  readonly toolRegistry: ToolRegistry;
  readonly toolPermissionPolicy: ToolPermissionPolicy;
  readonly toolExecutionPolicy: ToolExecutionPolicy;
}

export interface SessionlessInteractionResponse extends ActorDirectResult {
  readonly toolRun: ToolRunInspection;
}

export interface SessionlessInteractionState extends SessionlessState {
  target?: InteractionCapability;
  history?: readonly ModelMessage[];
  userMessage?: UserModelMessage;
  modelRequest?: ActorInteractionRequest;
  toolPermissionPolicy?: ToolPermissionPolicy;
  tools?: ToolRuntime;
  toolsClosed?: boolean;
  outputCharacterCount?: number;
  response?: SessionlessInteractionResponse;
  completedResponse?: SessionlessInteractionResponse;
}

export type SessionlessInteractionStepName = SessionlessRequestStepName | 'buildTools';
export type SessionlessInteractionContext = WorkflowContext<
  SessionlessInteractionStepName,
  SessionlessInteractionState,
  BoundSessionlessInteractionResources
>;

export interface SessionlessInteractionWorkflowOptions extends Pick<
  WorkflowDefinition<
    SessionlessInteractionStepName,
    SessionlessRequestInput,
    SessionlessInteractionState,
    BoundSessionlessInteractionResources,
    SessionlessInteractionResponse | undefined
  >,
  'stepOverrides' | 'lifecycle' | 'condition' | 'createRunId' | 'executeStep'
> {
  readonly mode: 'interaction';
  readonly name?: string;
  readonly resources: SessionlessInteractionResources;
}
