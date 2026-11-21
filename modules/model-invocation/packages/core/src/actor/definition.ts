import { assertActorRecordKeys } from './record-validation.js';
import { ActorError } from './errors.js';
import { defineActorCapabilityLimits } from './capabilities/index.js';
import { parseActorId, parseActorEngineId } from './identifiers.js';
import { parseActorInstructions } from './instructions.js';
import { defineActorInvocationConfig } from './invocation-config.js';
import { defineActorInvocationPolicy } from './invocation-policy.js';
import { bindTextTokenCounter } from '../token-measurement/index.js';
import type { ActorDefinitionInput, ActorDefinition } from './types/definition.js';

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
  assertActorRecordKeys(input, ACTOR_KEYS, 'Actor definition', 'ACTOR_DEFINITION_INVALID');
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
