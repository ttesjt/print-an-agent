import type { Api, Context, Model, Models } from '@earendil-works/pi-ai';
import type {
  ActorInvocationConfig,
  ActorEngineInteractionRequest,
  ActorEngineDirectRequest,
  ActorEngineStreamingRequest,
  ActorDirectResult,
  ModelInteractionResult,
  ModelInteractionEvent,
  ProviderModelReference,
  ProviderTransportLivenessPolicy,
  ProviderCredentialResolver,
} from '@print-an-agent/model-invocation-core';
import type { PiInvocationKind } from '../types.js';

export type PiObservedToolEvent = Extract<
  ModelInteractionEvent,
  { type: 'tool-call-start' | 'tool-call-end' }
>;

export type PiToolEventObserver = (event: PiObservedToolEvent) => void;
export interface PiRuntimeHooks {
  readonly observeInvocation?: (
    context: Context,
    kind: PiInvocationKind,
    config: ActorInvocationConfig
  ) => void;
  readonly observeToolEvent?: PiToolEventObserver;
}

export interface PiRuntimeOptions {
  readonly models: Models;
  readonly model: Model<Api>;
  readonly modelReference: ProviderModelReference;
  readonly transportLivenessPolicy: ProviderTransportLivenessPolicy;
  readonly credentialResolver?: ProviderCredentialResolver;
  readonly hooks?: PiRuntimeHooks;
}

/** Minimum callable surface needed by the Core Engine binding. */
export interface PiRuntimeHandlers {
  interact(request: ActorEngineInteractionRequest): Promise<ModelInteractionResult>;
  complete(request: ActorEngineDirectRequest): Promise<ActorDirectResult>;
  stream(request: ActorEngineStreamingRequest): Promise<ActorDirectResult>;
}
