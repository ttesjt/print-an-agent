import { ActorError } from './errors.js';
import { parseActorEngineId } from './identifiers.js';
import { defineActorEngineCapabilities } from './capabilities/index.js';
import { bindTextTokenCounter } from '../token-measurement/index.js';
import { assertActorRecordKeys } from './record-validation.js';
import type { ActorEngine, ActorEngineInput } from './types/engine.js';

const ENGINE_KEYS = Object.freeze([
  'id',
  'capabilities',
  'interact',
  'complete',
  'stream',
  'textTokenCounter',
]);

export function defineActorEngine(input: ActorEngineInput): ActorEngine {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError('ACTOR_ENGINE_INVALID', 'Actor Engine must be an object.');
  }
  assertActorRecordKeys(input, ENGINE_KEYS, 'Actor Engine');
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
