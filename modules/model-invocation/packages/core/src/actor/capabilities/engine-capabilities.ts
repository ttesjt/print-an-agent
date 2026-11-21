import { ActorError } from '../errors.js';
import { ACTOR_INVOCATION_MODES, ACTOR_INPUT_MEDIA_TYPES } from './options.js';
import type {
  ActorInteractionCapabilities,
  ActorEngineCapabilitiesInput,
  ActorEngineCapabilities,
} from './types.js';
import {
  CAPABILITY_KEYS,
  INTERACTION_CAPABILITY_KEYS,
  assertExactKeys,
  parseUniqueValues,
  parseOptionalPositiveInteger,
  requireBoolean,
} from './validation.js';

function defineActorInteractionCapabilities(
  input: ActorInteractionCapabilities
): ActorInteractionCapabilities {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor interaction capabilities must be an object.'
    );
  }
  assertExactKeys(input, INTERACTION_CAPABILITY_KEYS, 'Actor interaction capabilities');
  return Object.freeze({
    streamable: requireBoolean(input.streamable, 'Actor interaction streamable capability'),
  });
}

export function defineActorEngineCapabilities(
  input: ActorEngineCapabilitiesInput
): ActorEngineCapabilities {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor Engine capabilities must be an object.'
    );
  }
  assertExactKeys(input, CAPABILITY_KEYS, 'Actor Engine capabilities');
  const invocationModes = parseUniqueValues(
    input.invocationModes,
    ACTOR_INVOCATION_MODES,
    'Actor invocationModes',
    false
  );
  const supportsInteraction = invocationModes.includes('interaction');
  if (supportsInteraction !== (input.interaction !== undefined)) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor interaction capabilities must exist exactly when interaction invocation is supported.'
    );
  }
  const interaction =
    input.interaction === undefined
      ? undefined
      : defineActorInteractionCapabilities(input.interaction);
  const maxContextTokens = parseOptionalPositiveInteger(
    input.maxContextTokens,
    'Actor maxContextTokens'
  );
  return Object.freeze({
    invocationModes,
    inputMediaTypes: parseUniqueValues(
      input.inputMediaTypes,
      ACTOR_INPUT_MEDIA_TYPES,
      'Actor inputMediaTypes',
      false
    ),
    ...(interaction === undefined ? {} : { interaction }),
    toolCalling: requireBoolean(input.toolCalling, 'Actor toolCalling capability'),
    structuredOutput: requireBoolean(input.structuredOutput, 'Actor structuredOutput capability'),
    cancellation: requireBoolean(input.cancellation, 'Actor cancellation capability'),
    ...(maxContextTokens === undefined ? {} : { maxContextTokens }),
  });
}
