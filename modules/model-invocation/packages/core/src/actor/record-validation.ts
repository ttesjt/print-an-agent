import { ActorError } from './errors.js';

export function assertActorRecordKeys(
  value: object,
  allowed: readonly string[],
  label: string,
  errorCode:
    | 'ACTOR_ENGINE_INVALID'
    | 'ACTOR_DEFINITION_INVALID'
    | 'ACTOR_CAPABILITIES_INVALID' = 'ACTOR_ENGINE_INVALID'
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new ActorError(errorCode, `${label} contains unsupported field "${unexpected}".`);
  }
}
