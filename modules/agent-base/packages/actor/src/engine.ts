import type {
  AgentLoopEventSink,
  AgentLoopResult,
  AssistantModelMessage,
  ModelMessage,
  UserModelMessage,
} from '@ta-agent/base-model';
import type { ToolRuntime } from '@ta-agent/base-tool';
import {
  defineActorEngineCapabilities,
  type ActorEngineCapabilities,
  type ActorEngineCapabilitiesInput,
} from './capabilities.js';
import { AgentActorError } from './errors.js';
import { parseActorEngineId, type ActorEngineId } from './identifiers.js';

export interface ActorInvocationConfig {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface ActorInteractionRequest {
  readonly instructions: string;
  readonly history: readonly ModelMessage[];
  readonly prompt: UserModelMessage;
  readonly tools: ToolRuntime;
  readonly maxModelTurns: number;
  readonly maxOutputCharacters: number;
  readonly signal: AbortSignal;
  readonly emit: AgentLoopEventSink;
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

export interface ActorEngineInteractionRequest extends ActorInteractionRequest {
  readonly invocationConfig: ActorInvocationConfig;
}

export interface ActorEngineDirectRequest extends ActorDirectRequest {
  readonly invocationConfig: ActorInvocationConfig;
}

export type ActorInteractionHandler = (
  request: ActorEngineInteractionRequest
) => Promise<AgentLoopResult>;
export type ActorDirectHandler = (request: ActorEngineDirectRequest) => Promise<ActorDirectResult>;

export interface ActorEngineInput {
  readonly id: string;
  readonly capabilities: ActorEngineCapabilitiesInput;
  readonly interact?: ActorInteractionHandler;
  readonly complete?: ActorDirectHandler;
}

export interface ActorEngine {
  readonly id: ActorEngineId;
  readonly capabilities: ActorEngineCapabilities;
  readonly interact?: ActorInteractionHandler;
  readonly complete?: ActorDirectHandler;
}

const ENGINE_KEYS = Object.freeze(['id', 'capabilities', 'interact', 'complete']);
const INVOCATION_CONFIG_KEYS = Object.freeze(['temperature', 'maxOutputTokens']);

function assertExactKeys(
  value: object,
  allowed: readonly string[],
  label: string,
  errorCode: 'ACTOR_ENGINE_INVALID' | 'ACTOR_DEFINITION_INVALID' = 'ACTOR_ENGINE_INVALID'
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new AgentActorError(errorCode, `${label} contains unsupported field "${unexpected}".`);
  }
}

export function defineActorInvocationConfig(
  input: ActorInvocationConfig | undefined
): ActorInvocationConfig {
  if (input === undefined) return Object.freeze({});
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor invocation config must be an object.'
    );
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
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor temperature must be a finite number between 0 and 2.'
    );
  }
  if (
    input.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)
  ) {
    throw new AgentActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor maxOutputTokens must be a positive safe integer.'
    );
  }
  return Object.freeze({ ...input });
}

export function defineActorEngine(input: ActorEngineInput): ActorEngine {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError('ACTOR_ENGINE_INVALID', 'Actor Engine must be an object.');
  }
  assertExactKeys(input, ENGINE_KEYS, 'Actor Engine');
  const id = parseActorEngineId(input.id);
  const capabilities = defineActorEngineCapabilities(input.capabilities);
  const supportsInteraction = capabilities.invocationModes.includes('interaction');
  const supportsDirect = capabilities.invocationModes.includes('direct');
  if (supportsInteraction !== (typeof input.interact === 'function')) {
    throw new AgentActorError(
      'ACTOR_ENGINE_INVALID',
      'Actor Engine interaction capability must exactly match its interaction handler.'
    );
  }
  if (supportsDirect !== (typeof input.complete === 'function')) {
    throw new AgentActorError(
      'ACTOR_ENGINE_INVALID',
      'Actor Engine direct capability must exactly match its completion handler.'
    );
  }
  return Object.freeze({
    id,
    capabilities,
    ...(input.interact === undefined ? {} : { interact: input.interact }),
    ...(input.complete === undefined ? {} : { complete: input.complete }),
  });
}
