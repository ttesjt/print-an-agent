import type { ModelInteractionResult } from '../model/index.js';
import { narrowActorCapabilities } from './capabilities/index.js';
import { defineActorEngine } from './engine.js';
import { defineActor } from './definition.js';
import { ActorError } from './errors.js';
import {
  invokeActorCompletion,
  invokeActorInteraction,
  invokeActorStream,
} from './invocation/index.js';
import type { ActorDefinition, ResolvedActor, CreateActorOptions } from './types/definition.js';
import type { ActorEngine } from './types/engine.js';
import type {
  ActorInteractionRequest,
  ActorDirectRequest,
  ActorDirectResult,
  ActorStreamingRequest,
} from './types/invocation.js';

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
    interact(this: void, request: ActorInteractionRequest): Promise<ModelInteractionResult> {
      return invokeActorInteraction(definition, capabilities, engine, request);
    },
    complete(this: void, request: ActorDirectRequest): Promise<ActorDirectResult> {
      return invokeActorCompletion(definition, capabilities, engine, request);
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

export function createActor({ engine, ...input }: CreateActorOptions): ResolvedActor {
  return resolveActor(defineActor({ ...input, engineId: engine.id }), defineActorEngine(engine));
}
