import type {
  BoundSessionlessGenerationResources,
  BoundSessionlessInteractionResources,
  SessionlessGenerationState,
  SessionlessGenerationWorkflowOptions,
  SessionlessInteractionResponse,
  SessionlessInteractionState,
  SessionlessInteractionStepName,
  SessionlessInteractionWorkflowOptions,
  SessionlessRequestInput,
  SessionlessRequestStepName,
} from '@print-an-agent/base-request';
import type { ActorDirectResult } from '@print-an-agent/model-invocation-core';
import type { Workflow } from '@print-an-agent/workflow-core';

export type SessionlessGenerationWorkflow = Workflow<
  SessionlessRequestStepName,
  SessionlessRequestInput,
  SessionlessGenerationState,
  BoundSessionlessGenerationResources,
  ActorDirectResult | undefined
>;
export type SessionlessInteractionWorkflow = Workflow<
  SessionlessInteractionStepName,
  SessionlessRequestInput,
  SessionlessInteractionState,
  BoundSessionlessInteractionResources,
  SessionlessInteractionResponse | undefined
>;

export interface SessionlessRequestService<TTarget, TWorkflow> {
  /** Resolve borrowed resources and return the actual Workflow, without executing it. */
  open(target: TTarget, options?: Readonly<{ signal?: AbortSignal }>): Promise<TWorkflow>;
}

interface ServiceDefinition<TTarget, TOptions extends SessionlessGenerationWorkflowOptions> {
  readonly workflow: Omit<TOptions, 'resources'>;
  readonly resolveResources: (
    input: Readonly<{ target: TTarget; signal: AbortSignal }>
  ) => TOptions['resources'] | Promise<TOptions['resources']>;
}

export type SessionlessGenerationServiceDefinition<TTarget> = ServiceDefinition<
  TTarget,
  SessionlessGenerationWorkflowOptions
>;

// Interaction has a different Step/context/result contract, not a generation with optional fields.
export interface SessionlessInteractionServiceDefinition<TTarget> {
  readonly workflow: Omit<SessionlessInteractionWorkflowOptions, 'resources'>;
  readonly resolveResources: (
    input: Readonly<{ target: TTarget; signal: AbortSignal }>
  ) =>
    | SessionlessInteractionWorkflowOptions['resources']
    | Promise<SessionlessInteractionWorkflowOptions['resources']>;
}
