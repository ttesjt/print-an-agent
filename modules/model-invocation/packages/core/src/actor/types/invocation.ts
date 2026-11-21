import type {
  ModelInteractionEventSink,
  ModelInteractionResult,
  AssistantModelMessage,
  ModelMessage,
  UserModelMessage,
  ModelGenerationEventSink,
  InteractionTools,
} from '../../model/index.js';
import type { ActorId } from '../identifiers.js';
import type { ActorInvocationPolicy } from '../invocation-policy.js';

export interface ActorInvocationConfig {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface ActorInteractionRequest {
  readonly instructions: string;
  readonly history: readonly ModelMessage[];
  readonly prompt: UserModelMessage;
  readonly tools: InteractionTools;
  readonly maxModelTurns: number;
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
  readonly emit: ModelInteractionEventSink;
}

export interface ActorDirectRequest {
  readonly instructions: string;
  readonly messages: readonly ModelMessage[];
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
}

export interface ActorDirectResult {
  readonly message: AssistantModelMessage;
}

export interface ActorStreamingRequest extends ActorDirectRequest {
  readonly maxReasoningCharacters: number;
  readonly emit: ModelGenerationEventSink;
}

export interface ActorEngineStreamingRequest extends ActorStreamingRequest {
  readonly invocationConfig: ActorInvocationConfig;
}

export type ActorStreamingHandler = (
  request: ActorEngineStreamingRequest
) => Promise<ActorDirectResult>;

export interface ActorEngineInteractionRequest extends ActorInteractionRequest {
  readonly invocationConfig: ActorInvocationConfig;
}

export interface ActorEngineDirectRequest extends ActorDirectRequest {
  readonly invocationConfig: ActorInvocationConfig;
}

export type ActorInteractionHandler = (
  request: ActorEngineInteractionRequest
) => Promise<ModelInteractionResult>;

export type ActorDirectHandler = (request: ActorEngineDirectRequest) => Promise<ActorDirectResult>;
export interface CompletionCapability {
  complete(request: ActorDirectRequest): Promise<ActorDirectResult>;
}

export interface InteractionCapability {
  interact(request: ActorInteractionRequest): Promise<ModelInteractionResult>;
}

export interface StreamingCapability {
  stream(request: ActorStreamingRequest): Promise<ActorDirectResult>;
}

/** Only the binding facts used during invocation; no catalog, Engine lookup or capability policy. */
export interface ActorInvocationBinding {
  readonly id: ActorId;
  readonly instructions?: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly invocationPolicy: ActorInvocationPolicy;
}

/** Shared Engine handler surface; binding metadata and capability declarations are separate. */
export interface ActorEngineHandlers {
  readonly interact?: ActorInteractionHandler;
  readonly complete?: ActorDirectHandler;
  readonly stream?: ActorStreamingHandler;
}
