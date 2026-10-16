import { ActorError } from './errors.js';

declare const actorIdBrand: unique symbol;
declare const actorEngineIdBrand: unique symbol;

export type ActorId = string & { readonly [actorIdBrand]: 'ActorId' };
export type ActorEngineId = string & { readonly [actorEngineIdBrand]: 'ActorEngineId' };

const IDENTIFIER_MAX_LENGTH = 128;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

function parseIdentifier(
  value: unknown,
  code: 'ACTOR_ID_INVALID' | 'ACTOR_ENGINE_ID_INVALID',
  label: string
): string {
  if (
    typeof value !== 'string' ||
    value.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new ActorError(
      code,
      `${label} must contain 1-${IDENTIFIER_MAX_LENGTH} letters, digits, dots, underscores, colons, or hyphens.`
    );
  }
  return value;
}

export function parseActorId(value: unknown): ActorId {
  return parseIdentifier(value, 'ACTOR_ID_INVALID', 'Actor ID') as ActorId;
}

export function parseActorEngineId(value: unknown): ActorEngineId {
  return parseIdentifier(value, 'ACTOR_ENGINE_ID_INVALID', 'Actor Engine ID') as ActorEngineId;
}
