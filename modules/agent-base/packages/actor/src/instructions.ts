import { AgentActorError } from './errors.js';

const MAX_INSTRUCTIONS_CHARACTERS = 32_768;

export function parseActorInstructions(
  value: unknown,
  label: string,
  errorCode:
    | 'ACTOR_DEFINITION_INVALID'
    | 'RESPONSIBILITY_DEFINITION_INVALID' = 'ACTOR_DEFINITION_INVALID'
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_INSTRUCTIONS_CHARACTERS
  ) {
    throw new AgentActorError(
      errorCode,
      `${label} must contain 1-${MAX_INSTRUCTIONS_CHARACTERS} characters when provided.`
    );
  }
  return value;
}

export function composeActorInstructions(...layers: readonly (string | undefined)[]): string {
  return layers
    .map((layer) => layer?.trim())
    .filter((layer): layer is string => layer !== undefined && layer.length > 0)
    .join('\n\n');
}
