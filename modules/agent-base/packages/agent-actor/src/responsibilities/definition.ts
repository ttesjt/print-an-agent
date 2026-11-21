import {
  parseActorId,
  parseActorInstructions,
  type ActorCapabilityRequirements,
  type ActorCapabilityRequirementsIssue,
  validateActorCapabilityRequirements,
} from '@print-an-agent/model-invocation-core';
import { parseToolName, type ToolName } from '@print-an-agent/base-tool';
import { AgentActorError } from '../errors.js';
import { parseResponsibilityId } from './identifiers.js';
import type {
  ResponsibilityActorCandidateInput,
  ResponsibilityActorCandidate,
  ResponsibilityDefinitionInput,
  ResponsibilityDefinition,
} from './types/definition.js';

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
const REQUIREMENT_ERROR_MESSAGES: Readonly<Record<ActorCapabilityRequirementsIssue, string>> =
  Object.freeze({
    'object-required': 'Responsibility requiredCapabilities must be an object.',
    'definition-invalid': 'Responsibility requiredCapabilities is invalid.',
    'interaction-invalid':
      'Responsibility interaction requirement must require streamable interaction mode.',
    'media-types-invalid': 'Responsibility inputMediaTypes must contain unique supported values.',
    toolCalling: 'Responsibility toolCalling requirement can only require true.',
    structuredOutput: 'Responsibility structuredOutput requirement can only require true.',
    cancellation: 'Responsibility cancellation requirement can only require true.',
    'context-tokens-invalid':
      'Responsibility minimumContextTokens must be a positive safe integer.',
  });

function parseRequirements(input: ActorCapabilityRequirements): ActorCapabilityRequirements {
  const result = validateActorCapabilityRequirements(input);
  if (!result.valid) {
    throw new AgentActorError(
      'RESPONSIBILITY_DEFINITION_INVALID',
      REQUIREMENT_ERROR_MESSAGES[result.issue]
    );
  }
  return result.value;
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
