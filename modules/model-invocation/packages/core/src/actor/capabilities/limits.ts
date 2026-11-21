import { ActorError } from '../errors.js';
import { ACTOR_INVOCATION_MODES, ACTOR_INPUT_MEDIA_TYPES } from './options.js';
import type { ActorInteractionCapabilityLimits, ActorCapabilityLimits } from './types.js';
import {
  CAPABILITY_KEYS,
  INTERACTION_CAPABILITY_KEYS,
  assertExactKeys,
  parseUniqueValues,
  parseOptionalPositiveInteger,
  parseOptionalBoolean,
} from './validation.js';

function defineActorInteractionCapabilityLimits(
  input: ActorInteractionCapabilityLimits
): ActorInteractionCapabilityLimits {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor interaction capability limits must be an object.'
    );
  }
  assertExactKeys(input, INTERACTION_CAPABILITY_KEYS, 'Actor interaction capability limits');
  const streamable = parseOptionalBoolean(input.streamable, 'Actor interaction streamable limit');
  return Object.freeze(streamable === undefined ? {} : { streamable });
}

export function defineActorCapabilityLimits(input: ActorCapabilityLimits): ActorCapabilityLimits {
  if (typeof input !== 'object' || input === null) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor capability limits must be an object.'
    );
  }
  assertExactKeys(input, CAPABILITY_KEYS, 'Actor capability limits');
  const invocationModes =
    input.invocationModes === undefined
      ? undefined
      : parseUniqueValues(
          input.invocationModes,
          ACTOR_INVOCATION_MODES,
          'Actor invocationModes limit',
          false
        );
  if (
    invocationModes !== undefined &&
    !invocationModes.includes('interaction') &&
    input.interaction !== undefined
  ) {
    throw new ActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor interaction limits cannot accompany invocationModes that exclude interaction.'
    );
  }
  const inputMediaTypes =
    input.inputMediaTypes === undefined
      ? undefined
      : parseUniqueValues(
          input.inputMediaTypes,
          ACTOR_INPUT_MEDIA_TYPES,
          'Actor inputMediaTypes limit',
          false
        );
  const interaction =
    input.interaction === undefined
      ? undefined
      : defineActorInteractionCapabilityLimits(input.interaction);
  const toolCalling = parseOptionalBoolean(input.toolCalling, 'Actor toolCalling limit');
  const structuredOutput = parseOptionalBoolean(
    input.structuredOutput,
    'Actor structuredOutput limit'
  );
  const cancellation = parseOptionalBoolean(input.cancellation, 'Actor cancellation limit');
  const maxContextTokens = parseOptionalPositiveInteger(
    input.maxContextTokens,
    'Actor maxContextTokens limit'
  );
  return Object.freeze({
    ...(invocationModes === undefined ? {} : { invocationModes }),
    ...(inputMediaTypes === undefined ? {} : { inputMediaTypes }),
    ...(interaction === undefined ? {} : { interaction }),
    ...(toolCalling === undefined ? {} : { toolCalling }),
    ...(structuredOutput === undefined ? {} : { structuredOutput }),
    ...(cancellation === undefined ? {} : { cancellation }),
    ...(maxContextTokens === undefined ? {} : { maxContextTokens }),
  });
}
