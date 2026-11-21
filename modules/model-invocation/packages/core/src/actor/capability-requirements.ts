import {
  ACTOR_INPUT_MEDIA_TYPES,
  ACTOR_INVOCATION_MODES,
  type ActorCapabilityRequirements,
  type ActorInputMediaType,
} from './capabilities.js';

const REQUIREMENT_FLAGS = Object.freeze([
  'toolCalling',
  'structuredOutput',
  'cancellation',
] as const);
const REQUIREMENT_ISSUES = Object.freeze({
  OBJECT_REQUIRED: 'object-required',
  DEFINITION_INVALID: 'definition-invalid',
  INTERACTION_INVALID: 'interaction-invalid',
  MEDIA_TYPES_INVALID: 'media-types-invalid',
  CONTEXT_TOKENS_INVALID: 'context-tokens-invalid',
} as const);

export type ActorCapabilityRequirementsIssue =
  | (typeof REQUIREMENT_FLAGS)[number]
  | (typeof REQUIREMENT_ISSUES)[keyof typeof REQUIREMENT_ISSUES];

export type ActorCapabilityRequirementsValidation =
  | Readonly<{ valid: true; value: ActorCapabilityRequirements }>
  | Readonly<{ valid: false; issue: ActorCapabilityRequirementsIssue }>;

const REQUIREMENT_KEYS = Object.freeze([
  'invocationMode',
  'inputMediaTypes',
  'interaction',
  'toolCalling',
  'structuredOutput',
  'cancellation',
  'minimumContextTokens',
]);
const INTERACTION_REQUIREMENT_KEYS = Object.freeze(['streamable']);

function invalid(issue: ActorCapabilityRequirementsIssue): ActorCapabilityRequirementsValidation {
  return Object.freeze({ valid: false, issue });
}

/** Normalize technical selection requirements; callers own domain-specific error reporting. */
export function validateActorCapabilityRequirements(
  input: ActorCapabilityRequirements
): ActorCapabilityRequirementsValidation {
  if (typeof input !== 'object' || input === null) {
    return invalid(REQUIREMENT_ISSUES.OBJECT_REQUIRED);
  }
  const unexpected = Object.keys(input).find((key) => !REQUIREMENT_KEYS.includes(key));
  if (unexpected !== undefined || !ACTOR_INVOCATION_MODES.includes(input.invocationMode)) {
    return invalid(REQUIREMENT_ISSUES.DEFINITION_INVALID);
  }
  const interaction = input.interaction;
  if (
    interaction !== undefined &&
    (input.invocationMode !== 'interaction' ||
      typeof interaction !== 'object' ||
      interaction === null ||
      Object.keys(interaction).some((key) => !INTERACTION_REQUIREMENT_KEYS.includes(key)) ||
      interaction.streamable !== true)
  ) {
    return invalid(REQUIREMENT_ISSUES.INTERACTION_INVALID);
  }
  const mediaTypes = input.inputMediaTypes;
  const mediaValues =
    mediaTypes === undefined ? undefined : Array.from(mediaTypes as readonly unknown[]);
  if (
    mediaValues !== undefined &&
    (mediaValues.length === 0 ||
      mediaValues.some(
        (value) =>
          typeof value !== 'string' ||
          !ACTOR_INPUT_MEDIA_TYPES.includes(value as ActorInputMediaType)
      ) ||
      new Set(mediaValues).size !== mediaValues.length)
  ) {
    return invalid(REQUIREMENT_ISSUES.MEDIA_TYPES_INVALID);
  }
  for (const field of REQUIREMENT_FLAGS) {
    if (input[field] !== undefined && input[field] !== true) {
      return invalid(field);
    }
  }
  if (
    input.minimumContextTokens !== undefined &&
    (!Number.isSafeInteger(input.minimumContextTokens) || input.minimumContextTokens < 1)
  ) {
    return invalid(REQUIREMENT_ISSUES.CONTEXT_TOKENS_INVALID);
  }
  const value = Object.freeze({
    invocationMode: input.invocationMode,
    ...(mediaValues === undefined
      ? {}
      : {
          inputMediaTypes: Object.freeze(mediaValues.map((value) => value as ActorInputMediaType)),
        }),
    ...(interaction === undefined
      ? {}
      : { interaction: Object.freeze({ streamable: true as const }) }),
    ...(input.toolCalling === undefined ? {} : { toolCalling: true }),
    ...(input.structuredOutput === undefined ? {} : { structuredOutput: true }),
    ...(input.cancellation === undefined ? {} : { cancellation: true }),
    ...(input.minimumContextTokens === undefined
      ? {}
      : { minimumContextTokens: input.minimumContextTokens }),
  });
  return Object.freeze({ valid: true, value });
}
