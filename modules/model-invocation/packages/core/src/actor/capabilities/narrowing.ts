import { ActorError } from '../errors.js';
import { ACTOR_INVOCATION_MODES, ACTOR_INPUT_MEDIA_TYPES } from './options.js';
import type { ActorCapabilityLimits, ActorEngineCapabilities } from './types.js';
import { defineActorCapabilityLimits } from './limits.js';
import { parseUniqueValues } from './validation.js';

function assertBooleanNarrowing(
  engineValue: boolean,
  requested: boolean | undefined,
  label: string
): boolean {
  if (requested === true && !engineValue) {
    throw new ActorError('ACTOR_CAPABILITY_WIDENING', `Actor cannot enable unsupported ${label}.`);
  }
  return requested ?? engineValue;
}

function narrowValues<T extends string>(
  engineValues: readonly T[],
  requested: readonly T[] | undefined,
  allowed: readonly T[],
  label: string
): readonly T[] {
  if (requested === undefined) return engineValues;
  const parsed = parseUniqueValues(requested, allowed, label, false);
  const widened = parsed.find((value) => !engineValues.includes(value));
  if (widened !== undefined) {
    throw new ActorError(
      'ACTOR_CAPABILITY_WIDENING',
      `Actor cannot enable unsupported ${label} value "${widened}".`
    );
  }
  return parsed;
}

export function narrowActorCapabilities(
  engine: ActorEngineCapabilities,
  limits: ActorCapabilityLimits | undefined
): ActorEngineCapabilities {
  if (limits === undefined) return engine;
  const parsedLimits = defineActorCapabilityLimits(limits);
  const requestedMax = parsedLimits.maxContextTokens;
  if (
    requestedMax !== undefined &&
    (engine.maxContextTokens === undefined || requestedMax > engine.maxContextTokens)
  ) {
    throw new ActorError(
      'ACTOR_CAPABILITY_WIDENING',
      'Actor maxContextTokens cannot exceed an Engine bound or claim an unspecified bound.'
    );
  }
  const invocationModes = narrowValues(
    engine.invocationModes,
    parsedLimits.invocationModes,
    ACTOR_INVOCATION_MODES,
    'invocationModes'
  );
  const interaction = invocationModes.includes('interaction')
    ? Object.freeze({
        streamable: assertBooleanNarrowing(
          engine.interaction?.streamable ?? false,
          parsedLimits.interaction?.streamable,
          'interaction streamability'
        ),
      })
    : undefined;
  return Object.freeze({
    invocationModes,
    inputMediaTypes: narrowValues(
      engine.inputMediaTypes,
      parsedLimits.inputMediaTypes,
      ACTOR_INPUT_MEDIA_TYPES,
      'inputMediaTypes'
    ),
    ...(interaction === undefined ? {} : { interaction }),
    toolCalling: assertBooleanNarrowing(
      engine.toolCalling,
      parsedLimits.toolCalling,
      'toolCalling'
    ),
    structuredOutput: assertBooleanNarrowing(
      engine.structuredOutput,
      parsedLimits.structuredOutput,
      'structuredOutput'
    ),
    cancellation: assertBooleanNarrowing(
      engine.cancellation,
      parsedLimits.cancellation,
      'cancellation'
    ),
    ...((requestedMax ?? engine.maxContextTokens) === undefined
      ? {}
      : { maxContextTokens: requestedMax ?? engine.maxContextTokens }),
  });
}
