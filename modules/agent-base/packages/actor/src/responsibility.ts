import {
  parseActorId,
  requireCompletionCapability,
  requireInteractionCapability,
  requireStreamingCapability,
  type ActorId,
} from '@ta-agent/model-invocation-core';
import type { ModelInteractionResult } from '@ta-agent/model-invocation-core';
import { parseToolName, type ToolName } from '@ta-agent/base-tool';
import {
  ACTOR_INPUT_MEDIA_TYPES,
  ACTOR_INVOCATION_MODES,
  satisfiesActorRequirements,
  type ActorCapabilityRequirements,
  type ActorInputMediaType,
} from '@ta-agent/model-invocation-core';
import type { ResolvedActor } from './actor.js';
import type {
  ActorDirectRequest,
  ActorDirectResult,
  ActorInteractionRequest,
  ActorStreamingRequest,
} from '@ta-agent/model-invocation-core';
import { AgentActorError } from './errors.js';
import { parseResponsibilityId, type ResponsibilityId } from './identifiers.js';
import { composeActorInstructions, parseActorInstructions } from '@ta-agent/model-invocation-core';

export interface ResponsibilityActorCandidateInput {
  readonly actorId: string;
  readonly enabled: boolean;
}

export interface ResponsibilityActorCandidate {
  readonly actorId: ActorId;
  readonly enabled: boolean;
}

export interface ResponsibilityDefinitionInput {
  readonly id: string;
  readonly actors?: readonly ResponsibilityActorCandidateInput[];
  readonly instructions?: string;
  readonly requiredCapabilities: ActorCapabilityRequirements;
  readonly allowedTools?: readonly string[];
}

export interface ResponsibilityDefinition {
  readonly id: ResponsibilityId;
  readonly actors?: readonly ResponsibilityActorCandidate[];
  readonly instructions?: string;
  readonly requiredCapabilities: ActorCapabilityRequirements;
  readonly allowedTools: readonly ToolName[];
}

export interface ResolvedResponsibility {
  readonly id: ResponsibilityId;
  readonly catalogRevision: number;
  readonly actor: ResolvedActor;
  readonly candidateIndex: number;
  readonly allowedTools: readonly ToolName[];
  readonly effectiveCandidates: readonly ResponsibilityActorCandidate[];
  interact(request: ActorInteractionRequest): Promise<ModelInteractionResult>;
  complete(request: ActorDirectRequest): Promise<ActorDirectResult>;
  stream?(request: ActorStreamingRequest): Promise<ActorDirectResult>;
}

const RESPONSIBILITY_KEYS = Object.freeze([
  'id',
  'actors',
  'instructions',
  'requiredCapabilities',
  'allowedTools',
]);

function parseResponsibilityInstructions(value: unknown): string | undefined {
  try {
    return parseActorInstructions(value, 'Responsibility instructions');
  } catch (cause) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility instructions are invalid.',
      { cause }
    );
  }
}
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

function parseRequirements(input: ActorCapabilityRequirements): ActorCapabilityRequirements {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility requiredCapabilities must be an object.'
    );
  }
  const unexpected = Object.keys(input).find((key) => !REQUIREMENT_KEYS.includes(key));
  if (unexpected !== undefined || !ACTOR_INVOCATION_MODES.includes(input.invocationMode)) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility requiredCapabilities is invalid.'
    );
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
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility interaction requirement must require streamable interaction mode.'
    );
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
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility inputMediaTypes must contain unique supported values.'
    );
  }
  for (const field of ['toolCalling', 'structuredOutput', 'cancellation'] as const) {
    if (input[field] !== undefined && input[field] !== true) {
      throw new AgentActorError(
        'RESPONSIBILITY_DEFINITION_INVALID',
        `Responsibility ${field} requirement can only require true.`
      );
    }
  }
  if (
    input.minimumContextTokens !== undefined &&
    (!Number.isSafeInteger(input.minimumContextTokens) || input.minimumContextTokens < 1)
  ) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility minimumContextTokens must be a positive safe integer.'
    );
  }
  return Object.freeze({
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
}

function parseCandidates(
  values: readonly ResponsibilityActorCandidateInput[] | undefined
): readonly ResponsibilityActorCandidate[] | undefined {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility actors must be an array.'
    );
  }
  const candidateValues = Array.from(values as readonly unknown[]);
  const parsed = candidateValues.map((candidate) => {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new AgentActorError(
        'RESPONSIBILITY_DEFINITION_INVALID',
        'Responsibility Actor candidate is invalid.'
      );
    }
    const record = candidate as Readonly<Record<string, unknown>>;
    if (
      Object.keys(record).some((key) => key !== 'actorId' && key !== 'enabled') ||
      typeof record.enabled !== 'boolean'
    ) {
      throw new AgentActorError(
        'RESPONSIBILITY_DEFINITION_INVALID',
        'Responsibility Actor candidate is invalid.'
      );
    }
    return Object.freeze({
      actorId: parseActorId(record.actorId),
      enabled: record.enabled,
    });
  });
  if (new Set(parsed.map((candidate) => candidate.actorId)).size !== parsed.length) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility actors contains duplicate Actor IDs.'
    );
  }
  return Object.freeze(parsed);
}

function parseAllowedTools(values: readonly string[] | undefined): readonly ToolName[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values)) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility allowedTools must be an array.'
    );
  }
  let parsed: readonly ToolName[];
  try {
    parsed = values.map(parseToolName);
  } catch (cause: unknown) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility allowedTools contains an invalid Tool name.',
      { cause }
    );
  }
  if (new Set(parsed).size !== parsed.length) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility allowedTools contains duplicates.'
    );
  }
  return Object.freeze(parsed);
}

export function defineResponsibility(
  input: ResponsibilityDefinitionInput
): ResponsibilityDefinition {
  if (typeof input !== 'object' || input === null) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      'Responsibility definition must be an object.'
    );
  }
  const unexpected = Object.keys(input).find((key) => !RESPONSIBILITY_KEYS.includes(key));
  if (unexpected !== undefined) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      `Responsibility definition contains unsupported field "${unexpected}".`
    );
  }
  const actors = parseCandidates(input.actors);
  const instructions = parseResponsibilityInstructions(input.instructions);
  return Object.freeze({
    id: parseResponsibilityId(input.id),
    ...(actors === undefined ? {} : { actors }),
    ...(instructions === undefined ? {} : { instructions }),
    requiredCapabilities: parseRequirements(input.requiredCapabilities),
    allowedTools: parseAllowedTools(input.allowedTools),
  });
}

export function resolveResponsibility(
  definition: ResponsibilityDefinition,
  catalogRevision: number,
  actor: ResolvedActor,
  candidateIndex: number,
  effectiveCandidates: readonly ResponsibilityActorCandidate[]
): ResolvedResponsibility {
  if (!satisfiesActorRequirements(actor.capabilities, definition.requiredCapabilities)) {
    throw new AgentActorError(
      'RESPONSIBILITY_CAPABILITY_UNAVAILABLE',
      `Actor "${actor.id}" does not satisfy Responsibility "${definition.id}".`
    );
  }
  return Object.freeze({
    id: definition.id,
    catalogRevision,
    actor,
    candidateIndex,
    allowedTools: definition.allowedTools,
    effectiveCandidates,
    interact: (request: ActorInteractionRequest) =>
      requireInteractionCapability(actor).interact({
        ...request,
        instructions: composeActorInstructions(definition.instructions, request.instructions),
      }),
    complete: (request: ActorDirectRequest) =>
      requireCompletionCapability(actor).complete({
        ...request,
        instructions: composeActorInstructions(definition.instructions, request.instructions),
      }),
    ...(actor.stream === undefined
      ? {}
      : {
          stream: (request: ActorStreamingRequest) =>
            requireStreamingCapability(actor).stream({
              ...request,
              instructions: composeActorInstructions(definition.instructions, request.instructions),
            }),
        }),
  });
}
