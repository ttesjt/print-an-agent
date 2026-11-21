import type { ActorDirectRequest, ActorDirectResult } from '@print-an-agent/model-invocation-core';
import type { WorkflowContext, WorkflowDefinition } from '@print-an-agent/workflow-core';
import type { SessionlessRequestStepName } from '../names.js';
import type { SessionlessRequestInput } from '../types/input.js';
import type {
  BoundSessionlessGenerationResources,
  SessionlessGenerationResources,
} from '../types/resources.js';
import type { SessionlessState } from '../types/state.js';
export type { SessionlessGenerationPolicy } from '../types/policy.js';
export type {
  BoundSessionlessGenerationResources,
  SessionlessGenerationResources,
} from '../types/resources.js';

export interface SessionlessGenerationState extends SessionlessState {
  modelRequest?: ActorDirectRequest;
  response?: ActorDirectResult;
  completedResponse?: ActorDirectResult;
}
export type SessionlessGenerationContext = WorkflowContext<
  SessionlessRequestStepName,
  SessionlessGenerationState,
  BoundSessionlessGenerationResources
>;

export interface SessionlessGenerationWorkflowOptions extends Pick<
  WorkflowDefinition<
    SessionlessRequestStepName,
    SessionlessRequestInput,
    SessionlessGenerationState,
    BoundSessionlessGenerationResources,
    ActorDirectResult | undefined
  >,
  'stepOverrides' | 'lifecycle' | 'condition' | 'createRunId' | 'executeStep'
> {
  readonly mode: 'direct' | 'stream';
  readonly name?: string;
  readonly resources: SessionlessGenerationResources;
}
