import { ActorError } from './errors.js';
import { assertActorRecordKeys } from './record-validation.js';
import type { ActorInvocationConfig } from './types/invocation.js';

const INVOCATION_CONFIG_KEYS = Object.freeze(['temperature', 'maxOutputTokens']);

export function defineActorInvocationConfig(
  input: ActorInvocationConfig | undefined
): ActorInvocationConfig {
  if (input === undefined) return Object.freeze({});
  if (typeof input !== 'object' || input === null) {
    throw new ActorError('ACTOR_DEFINITION_INVALID', 'Actor invocation config must be an object.');
  }
  assertActorRecordKeys(
    input,
    INVOCATION_CONFIG_KEYS,
    'Actor invocation config',
    'ACTOR_DEFINITION_INVALID'
  );
  if (
    input.temperature !== undefined &&
    (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
  ) {
    throw new ActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor temperature must be a finite number between 0 and 2.'
    );
  }
  if (
    input.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)
  ) {
    throw new ActorError(
      'ACTOR_DEFINITION_INVALID',
      'Actor maxOutputTokens must be a positive safe integer.'
    );
  }
  return Object.freeze({ ...input });
}
