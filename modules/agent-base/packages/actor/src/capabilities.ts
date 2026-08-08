import { AgentActorError } from './errors.js';

export const ACTOR_INVOCATION_MODES = Object.freeze(['interaction', 'direct'] as const);
export type ActorInvocationMode = (typeof ACTOR_INVOCATION_MODES)[number];

export const ACTOR_INPUT_MEDIA_TYPES = Object.freeze(['text', 'image', 'audio', 'video'] as const);
export type ActorInputMediaType = (typeof ACTOR_INPUT_MEDIA_TYPES)[number];

export interface ActorInteractionCapabilities {
  readonly streamable: boolean;
}

export interface ActorEngineCapabilitiesInput {
  readonly invocationModes: readonly ActorInvocationMode[];
  readonly inputMediaTypes: readonly ActorInputMediaType[];
  readonly interaction?: ActorInteractionCapabilities;
  readonly toolCalling: boolean;
  readonly structuredOutput: boolean;
  readonly cancellation: boolean;
  readonly maxContextTokens?: number;
}

export type ActorEngineCapabilities = ActorEngineCapabilitiesInput;

export interface ActorInteractionCapabilityLimits {
  readonly streamable?: boolean;
}

export interface ActorCapabilityLimits {
  readonly invocationModes?: readonly ActorInvocationMode[];
  readonly inputMediaTypes?: readonly ActorInputMediaType[];
  readonly interaction?: ActorInteractionCapabilityLimits;
  readonly toolCalling?: boolean;
  readonly structuredOutput?: boolean;
  readonly cancellation?: boolean;
  readonly maxContextTokens?: number;
}

export interface ActorInteractionCapabilityRequirements {
  readonly streamable: true;
}

export interface ActorCapabilityRequirements {
  readonly invocationMode: ActorInvocationMode;
  readonly inputMediaTypes?: readonly ActorInputMediaType[];
  readonly interaction?: ActorInteractionCapabilityRequirements;
  readonly toolCalling?: true;
  readonly structuredOutput?: true;
  readonly cancellation?: true;
  readonly minimumContextTokens?: number;
}

const CAPABILITY_KEYS = Object.freeze([
  'invocationModes',
  'inputMediaTypes',
  'interaction',
  'toolCalling',
  'structuredOutput',
  'cancellation',
  'maxContextTokens',
]);
const INTERACTION_CAPABILITY_KEYS = Object.freeze(['streamable']);

function assertExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new AgentActorError(
      'ACTOR_CAPABILITIES_INVALID',
      `${label} contains unsupported field "${unexpected}".`
    );
  }
}

function parseUniqueValues<T extends string>(
  values: unknown,
  allowed: readonly T[],
  label: string,
  allowEmpty: boolean
): readonly T[] {
  if (
    !Array.isArray(values) ||
    (!allowEmpty && values.length === 0) ||
    values.some((value) => typeof value !== 'string' || !allowed.includes(value as T)) ||
    new Set(values).size !== values.length
  ) {
    throw new AgentActorError(
      'ACTOR_CAPABILITIES_INVALID',
      `${label} must contain unique supported values${allowEmpty ? '' : ' and cannot be empty'}.`
    );
  }
  return Object.freeze(Array.from(values as readonly unknown[], (value) => value as T));
}

function parseOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AgentActorError(
      'ACTOR_CAPABILITIES_INVALID',
      `${label} must be a positive safe integer when provided.`
    );
  }
  return value as number;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AgentActorError('ACTOR_CAPABILITIES_INVALID', `${label} must be a boolean.`);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  return requireBoolean(value, label);
}

function defineActorInteractionCapabilities(
  input: ActorInteractionCapabilities
): ActorInteractionCapabilities {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor interaction capabilities must be an object.'
    );
  }
  assertExactKeys(input, INTERACTION_CAPABILITY_KEYS, 'Actor interaction capabilities');
  return Object.freeze({
    streamable: requireBoolean(input.streamable, 'Actor interaction streamable capability'),
  });
}

function defineActorInteractionCapabilityLimits(
  input: ActorInteractionCapabilityLimits
): ActorInteractionCapabilityLimits {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
      'ACTOR_CAPABILITIES_INVALID',
      'Actor interaction capability limits must be an object.'
    );
  }
  assertExactKeys(input, INTERACTION_CAPABILITY_KEYS, 'Actor interaction capability limits');
  const streamable = parseOptionalBoolean(input.streamable, 'Actor interaction streamable limit');
  return Object.freeze(streamable === undefined ? {} : { streamable });
}

export function defineActorEngineCapabilities(
  input: ActorEngineCapabilitiesInput
): ActorEngineCapabilities {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
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
    throw new AgentActorError(
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

export function defineActorCapabilityLimits(input: ActorCapabilityLimits): ActorCapabilityLimits {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
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
    throw new AgentActorError(
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

function assertBooleanNarrowing(
  engineValue: boolean,
  requested: boolean | undefined,
  label: string
): boolean {
  if (requested === true && !engineValue) {
    throw new AgentActorError(
      'ACTOR_CAPABILITY_WIDENING',
      `Actor cannot enable unsupported ${label}.`
    );
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
    throw new AgentActorError(
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
    throw new AgentActorError(
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

export function satisfiesActorRequirements(
  capabilities: ActorEngineCapabilities,
  requirements: ActorCapabilityRequirements
): boolean {
  if (!capabilities.invocationModes.includes(requirements.invocationMode)) return false;
  if (
    requirements.inputMediaTypes?.some(
      (mediaType) => !capabilities.inputMediaTypes.includes(mediaType)
    )
  ) {
    return false;
  }
  if (
    requirements.interaction?.streamable === true &&
    capabilities.interaction?.streamable !== true
  ) {
    return false;
  }
  if (requirements.toolCalling === true && !capabilities.toolCalling) return false;
  if (requirements.structuredOutput === true && !capabilities.structuredOutput) return false;
  if (requirements.cancellation === true && !capabilities.cancellation) return false;
  if (
    requirements.minimumContextTokens !== undefined &&
    (capabilities.maxContextTokens === undefined ||
      capabilities.maxContextTokens < requirements.minimumContextTokens)
  ) {
    return false;
  }
  return true;
}
