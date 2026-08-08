import { AgentActorError } from './errors.js';

declare const actorIdBrand: unique symbol;
declare const actorEngineIdBrand: unique symbol;
declare const responsibilityIdBrand: unique symbol;

export type ActorId = string & { readonly [actorIdBrand]: 'ActorId' };
export type ActorEngineId = string & { readonly [actorEngineIdBrand]: 'ActorEngineId' };
export type ResponsibilityId = string & {
  readonly [responsibilityIdBrand]: 'ResponsibilityId';
};

const IDENTIFIER_MAX_LENGTH = 128;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._:-]*[a-z0-9])?$/i;

function parseIdentifier(
  value: unknown,
  code: 'ACTOR_ID_INVALID' | 'ACTOR_ENGINE_ID_INVALID' | 'RESPONSIBILITY_ID_INVALID',
  label: string
): string {
  if (
    typeof value !== 'string' ||
    value.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new AgentActorError(
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

export function parseResponsibilityId(value: unknown): ResponsibilityId {
  return parseIdentifier(
    value,
    'RESPONSIBILITY_ID_INVALID',
    'Responsibility ID'
  ) as ResponsibilityId;
}

export const MAIN_ACTOR_ID = parseActorId('main');
export const FOREGROUND_INTERACTION_RESPONSIBILITY_ID =
  parseResponsibilityId('foreground-interaction');
export const SESSION_COMPACTION_RESPONSIBILITY_ID = parseResponsibilityId('session-compaction');
