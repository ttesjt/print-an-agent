import type {
  ActorDirectResult,
  ActorInteractionRequest,
  InteractionCapability,
  ModelMessage,
  UserModelMessage,
} from '@ta-agent/model-invocation-core';
import type {
  ToolExecutionPolicy,
  ToolPermissionPolicy,
  ToolPermissionPolicyInput,
  ToolRegistry,
  ToolRunInspection,
  ToolRuntime,
} from '@ta-agent/base-tool';
import type { WorkflowContext, WorkflowDefinition } from '@ta-agent/workflow-core';
import type {
  BoundSessionlessGenerationResources,
  SessionlessGenerationPolicy,
  SessionlessGenerationResources,
  SessionlessGenerationState,
  SessionlessRequestInput,
  SessionlessRequestStepName,
} from '../contracts.js';

export interface SessionlessInteractionPolicy extends SessionlessGenerationPolicy {
  readonly maxModelTurns: number;
}

export interface SessionlessInteractionResources extends Omit<
  SessionlessGenerationResources,
  'policy'
> {
  readonly policy?: Partial<SessionlessInteractionPolicy>;
  readonly tools?: {
    readonly registry: ToolRegistry;
    /** Core Actors have no permission authority; omission is deny-all. */
    readonly permissionPolicy?: ToolPermissionPolicyInput;
    readonly executionPolicy?: ToolExecutionPolicy;
  };
}

export interface BoundSessionlessInteractionResources extends Omit<
  BoundSessionlessGenerationResources,
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

export interface SessionlessInteractionState extends Omit<
  SessionlessGenerationState,
  'modelRequest' | 'response'
> {
  target?: InteractionCapability;
  history?: readonly ModelMessage[];
  userMessage?: UserModelMessage;
  modelRequest?: ActorInteractionRequest;
  toolPermissionPolicy?: ToolPermissionPolicy;
  tools?: ToolRuntime;
  toolsClosed?: boolean;
  outputCharacterCount?: number;
  response?: SessionlessInteractionResponse;
}

export type SessionlessInteractionStepName = SessionlessRequestStepName | 'buildTools';
export type SessionlessInteractionContext = WorkflowContext<
  SessionlessInteractionStepName,
  SessionlessRequestInput,
  SessionlessInteractionState,
  BoundSessionlessInteractionResources,
  SessionlessInteractionResponse | undefined
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
