import type {
  ModelInteractionEventSink,
  ModelInteractionResult,
  AssistantModelMessage,
  ModelMessage,
  UserModelMessage,
  ModelGenerationEventSink,
} from '../model/index.js';
import type { InteractionTools } from '../model/tools.js';
import {
  defineActorEngineCapabilities,
  type ActorEngineCapabilities,
  type ActorEngineCapabilitiesInput,
} from './capabilities.js';
import { ActorError } from './errors.js';
import { parseActorEngineId, type ActorEngineId } from './identifiers.js';
import { bindTextTokenCounter } from '../token-measurement/text-counter-binding.js';
import type { TokenCounter, TextTokenInput } from '../token-measurement/contracts.js';

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

export interface ActorEngineInput {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: string;
  readonly capabilities: ActorEngineCapabilitiesInput;
  readonly interact?: ActorInteractionHandler;
  readonly complete?: ActorDirectHandler;
  readonly stream?: ActorStreamingHandler;
}

export interface ActorEngine {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: ActorEngineId;
  readonly capabilities: ActorEngineCapabilities;
  readonly interact?: ActorInteractionHandler;
  readonly complete?: ActorDirectHandler;
  readonly stream?: ActorStreamingHandler;
}

const ENGINE_KEYS = Object.freeze([
  'id',
  'capabilities',
  'interact',
  'complete',
  'stream',
  'textTokenCounter',
]);
const INVOCATION_CONFIG_KEYS = Object.freeze(['temperature', 'maxOutputTokens']);

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  label: string,
  errorCode: 'ACTOR_ENGINE_INVALID' | 'ACTOR_DEFINITION_INVALID' = 'ACTOR_ENGINE_INVALID'
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new ActorError(errorCode, `${label} contains unsupported field "${unexpected}".`);
  }
}

export function defineActorInvocationConfig(
  input: ActorInvocationConfig | undefined
): ActorInvocationConfig {
  if (input === undefined) return Object.freeze({});
  if (typeof input !== 'object' || input === null) {
    throw new ActorError('ACTOR_DEFINITION_INVALID', 'Actor invocation config must be an object.');
  }
  assertExactKeys(
    input,
    INVOCATION_CONFIG_KEYS,
    'Actor invocation config',
    'ACTOR_DEFINITION_INVALID'
  );
  if (
    input.temperature !== undefined &&
    (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
  ) {
    throw new ActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor temperature must be a finite number between 0 and 2.'
    );
  }
  if (
    input.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)
  ) {
    throw new ActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor maxOutputTokens must be a positive safe integer.'
    );
  }
  return Object.freeze({ ...input });
}

export function defineActorEngine(input: ActorEngineInput): ActorEngine {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError('ACTOR_ENGINE_INVALID', 'Actor Engine must be an object.');
  }
  assertExactKeys(input, ENGINE_KEYS, 'Actor Engine');
  const id = parseActorEngineId(input.id);
  const capabilities = defineActorEngineCapabilities(input.capabilities);
  const supportsInteraction = capabilities.invocationModes.includes('interaction');
  const supportsDirect = capabilities.invocationModes.includes('direct');
  if (
    (input.stream !== undefined && typeof input.stream !== 'function') ||
    capabilities.invocationModes.includes('stream') !== (typeof input.stream === 'function')
  ) {
    throw new ActorError(
      'ACTOR_ENGINE_INVALID',
      'Actor Engine streaming capability must exactly match its streaming handler.'
    );
  }
  if (
    (input.interact !== undefined && typeof input.interact !== 'function') ||
    supportsInteraction !== (typeof input.interact === 'function')
  ) {
    throw new ActorError(
      'ACTOR_ENGINE_INVALID',
      'Actor Engine interaction capability must exactly match its interaction handler.'
    );
  }
  if (
    (input.complete !== undefined && typeof input.complete !== 'function') ||
    supportsDirect !== (typeof input.complete === 'function')
  ) {
    throw new ActorError(
      'ACTOR_ENGINE_INVALID',
      'Actor Engine direct capability must exactly match its completion handler.'
    );
  }
  return Object.freeze({
    id,
    capabilities,
    ...(input.textTokenCounter === undefined
      ? {}
      : { textTokenCounter: bindTextTokenCounter(input.textTokenCounter) }),
    ...(input.interact === undefined ? {} : { interact: input.interact }),
    ...(input.complete === undefined ? {} : { complete: input.complete }),
    ...(input.stream === undefined ? {} : { stream: input.stream }),
  });
}
