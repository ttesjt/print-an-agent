import { ModelInvocationError, type ModelInteractionResult } from '../model/index.js';
import {
  defineActorCapabilityLimits,
  narrowActorCapabilities,
  type ActorCapabilityLimits,
  type ActorEngineCapabilities,
} from './capabilities.js';
import {
  defineActorEngine,
  defineActorInvocationConfig,
  type ActorDirectRequest,
  type ActorDirectResult,
  type ActorEngine,
  type ActorEngineInput,
  type ActorInteractionRequest,
  type ActorInvocationConfig,
  type ActorStreamingRequest,
} from './engine.js';
import { ActorError } from './errors.js';
import {
  defineActorInvocationPolicy,
  type ActorInvocationPolicy,
  type ActorInvocationPolicyInput,
} from './invocation-policy.js';
import { runActorInvocation } from './invocation-timeout.js';
import { bindInteractionTools } from './interaction-tools.js';
import {
  parseActorEngineId,
  parseActorId,
  type ActorEngineId,
  type ActorId,
} from './identifiers.js';
import { composeActorInstructions, parseActorInstructions } from './instructions.js';
import { createActorInteractionProtocol } from './engine-protocol.js';
import { normalizeActorDirectResult } from './result-protocol.js';
import { invokeActorStream } from './stream-invocation.js';
import { bindTextTokenCounter } from '../token-measurement/text-counter-binding.js';
import type { TokenCounter, TextTokenInput } from '../token-measurement/contracts.js';

export interface ActorDefinitionInput {
  /** Optional borrowed override; absence inherits the Engine's text measurement capability. */
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: string;
  readonly engineId: string;
  readonly instructions?: string;
  readonly invocationConfig?: ActorInvocationConfig;
  readonly invocationPolicy?: ActorInvocationPolicyInput;
  readonly capabilityLimits?: ActorCapabilityLimits;
}

export interface ActorDefinition {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: ActorId;
  readonly engineId: ActorEngineId;
  readonly instructions?: string;
  readonly invocationConfig: ActorInvocationConfig;
  readonly invocationPolicy: ActorInvocationPolicy;
  readonly capabilityLimits?: ActorCapabilityLimits;
}

export interface ResolvedActor {
  readonly textTokenCounter?: TokenCounter<TextTokenInput>;
  readonly id: ActorId;
  readonly engineId: ActorEngineId;
  readonly catalogRevision?: number;
  readonly capabilities: ActorEngineCapabilities;
  interact?(request: ActorInteractionRequest): Promise<ModelInteractionResult>;
  complete?(request: ActorDirectRequest): Promise<ActorDirectResult>;
  stream?(request: ActorStreamingRequest): Promise<ActorDirectResult>;
}

const ACTOR_KEYS = Object.freeze([
  'textTokenCounter',
  'id',
  'engineId',
  'instructions',
  'invocationConfig',
  'invocationPolicy',
  'capabilityLimits',
]);

export function defineActor(input: ActorDefinitionInput): ActorDefinition {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError('ACTOR_DEFINITION_INVALID', 'Actor definition must be an object.');
  }
  const unexpected = Object.keys(input).find((key) => !ACTOR_KEYS.includes(key));
  if (unexpected !== undefined) {
    throw new ActorError(
      'ACTOR_DEFINITION_INVALID',
      `Actor definition contains unsupported field "${unexpected}".`
    );
  }
  const instructions = parseActorInstructions(input.instructions, 'Actor instructions');
  const capabilityLimits =
    input.capabilityLimits === undefined
      ? undefined
      : defineActorCapabilityLimits(input.capabilityLimits);
  return Object.freeze({
    id: parseActorId(input.id),
    ...(input.textTokenCounter === undefined
      ? {}
      : { textTokenCounter: bindTextTokenCounter(input.textTokenCounter) }),
    engineId: parseActorEngineId(input.engineId),
    ...(instructions === undefined ? {} : { instructions }),
    invocationConfig: defineActorInvocationConfig(input.invocationConfig),
    invocationPolicy: defineActorInvocationPolicy(input.invocationPolicy),
    ...(capabilityLimits === undefined ? {} : { capabilityLimits }),
  });
}

export function resolveActor(
  definition: ActorDefinition,
  engine: ActorEngine,
  catalogRevision?: number
): ResolvedActor {
  if (definition.engineId !== engine.id) {
    throw new ActorError(
      'ACTOR_ENGINE_NOT_FOUND',
      `Actor "${definition.id}" references unavailable Engine "${definition.engineId}".`
    );
  }
  const capabilities = narrowActorCapabilities(engine.capabilities, definition.capabilityLimits);
  const textTokenCounter = definition.textTokenCounter ?? engine.textTokenCounter;
  const resolved = {
    ...(textTokenCounter === undefined ? {} : { textTokenCounter }),
    id: definition.id,
    engineId: definition.engineId,
    ...(catalogRevision === undefined ? {} : { catalogRevision }),
    capabilities,
    async interact(this: void, request: ActorInteractionRequest): Promise<ModelInteractionResult> {
      const interact = engine.interact;
      if (!capabilities.invocationModes.includes('interaction') || interact === undefined) {
        throw new ActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          `Actor "${definition.id}" does not support interaction invocation.`
        );
      }
      if (request.tools.tools.length > 0 && !capabilities.toolCalling) {
        throw new ActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          `Actor "${definition.id}" does not support Tool calls.`
        );
      }
      return runActorInvocation(
        {
          actorId: definition.id,
          invocationKind: 'interact',
          parentSignal: request.signal,
          policy: definition.invocationPolicy,
        },
        async (signal, assertWithinDeadline) => {
          const protocol = createActorInteractionProtocol((event) => {
            assertWithinDeadline();
            return request.emit(event);
          }, request.maxModelTurns);
          let result: unknown;
          try {
            result = await interact({
              ...request,
              tools: bindInteractionTools(request.tools, signal),
              instructions: composeActorInstructions(definition.instructions, request.instructions),
              invocationConfig: definition.invocationConfig,
              signal,
              emit: protocol.emit,
            });
          } catch (cause: unknown) {
            protocol.assertValid();
            throw cause;
          } finally {
            protocol.close();
          }
          return protocol.complete(result);
        }
      );
    },
    async complete(this: void, request: ActorDirectRequest): Promise<ActorDirectResult> {
      if (!Number.isSafeInteger(request.maxOutputCharacters) || request.maxOutputCharacters < 1) {
        throw new ModelInvocationError(
          'MODEL_RUNTIME_PROTOCOL_INVALID',
          'Completion output budget must be a positive safe integer.'
        );
      }
      const complete = engine.complete;
      if (!capabilities.invocationModes.includes('direct') || complete === undefined) {
        throw new ActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          `Actor "${definition.id}" does not support direct invocation.`
        );
      }
      return runActorInvocation(
        {
          actorId: definition.id,
          invocationKind: 'complete',
          parentSignal: request.signal,
          policy: definition.invocationPolicy,
        },
        async (signal) => {
          const result = await complete({
            ...request,
            instructions: composeActorInstructions(definition.instructions, request.instructions),
            invocationConfig: definition.invocationConfig,
            signal,
          });
          return normalizeActorDirectResult(result, request.maxOutputCharacters);
        }
      );
    },
    stream(this: void, request: ActorStreamingRequest): Promise<ActorDirectResult> {
      if (engine.stream === undefined) {
        throw new ActorError(
          'ACTOR_INVOCATION_UNSUPPORTED',
          'Actor Engine does not support streaming generation.'
        );
      }
      return invokeActorStream(definition, engine.stream, request);
    },
  };
  const { interact, complete, stream, ...metadata } = resolved;
  return Object.freeze({
    ...metadata,
    ...(capabilities.invocationModes.includes('interaction') ? { interact } : {}),
    ...(capabilities.invocationModes.includes('direct') ? { complete } : {}),
    ...(capabilities.invocationModes.includes('stream') ? { stream } : {}),
  });
}

export interface CompletionCapability {
  complete(request: ActorDirectRequest): Promise<ActorDirectResult>;
}

export interface InteractionCapability {
  interact(request: ActorInteractionRequest): Promise<ModelInteractionResult>;
}

export interface StreamingCapability {
  stream(request: ActorStreamingRequest): Promise<ActorDirectResult>;
}

export function requireStreamingCapability<T extends ResolvedActor>(
  actor: T
): T & StreamingCapability {
  if (!hasStreaming(actor)) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${actor.id}" does not support streaming generation.`
    );
  }
  return actor;
}

function hasStreaming<T extends ResolvedActor>(actor: T): actor is T & StreamingCapability {
  return typeof actor.stream === 'function';
}

export interface CreateActorOptions extends Omit<ActorDefinitionInput, 'engineId'> {
  readonly engine: ActorEngineInput;
}

export function createActor({ engine, ...input }: CreateActorOptions): ResolvedActor {
  return resolveActor(defineActor({ ...input, engineId: engine.id }), defineActorEngine(engine));
}

export function requireCompletionCapability<T extends ResolvedActor>(
  actor: T
): T & CompletionCapability {
  if (!hasCompletion(actor)) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${actor.id}" does not support completion.`
    );
  }
  return actor;
}

function hasCompletion<T extends ResolvedActor>(actor: T): actor is T & CompletionCapability {
  return typeof actor.complete === 'function';
}

export function requireInteractionCapability<T extends ResolvedActor>(
  actor: T
): T & InteractionCapability {
  if (!hasInteraction(actor)) {
    throw new ActorError(
      'ACTOR_INVOCATION_UNSUPPORTED',
      `Actor "${actor.id}" does not support interaction.`
    );
  }
  return actor;
}

function hasInteraction<T extends ResolvedActor>(actor: T): actor is T & InteractionCapability {
  return typeof actor.interact === 'function';
}

/** Measurement is optional and independent of the Actor's invocation modes. */
export function requireActorTextTokenCounter(actor: ResolvedActor): TokenCounter<TextTokenInput> {
  if (actor.textTokenCounter === undefined) {
    throw new ActorError(
      'ACTOR_TOKEN_MEASUREMENT_UNAVAILABLE',
      'Actor has no text token counter bound.'
    );
  }
  return actor.textTokenCounter;
}
