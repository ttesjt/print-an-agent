import { AgentIdentityError } from '../types/errors.js';
import type { AgentId, AgentIdentity, AgentIdentityInput } from '../types/identity.js';

const AGENT_ID_MAX_LENGTH = 64;
const DISPLAY_NAME_MAX_LENGTH = 128;
const AGENT_ID_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function isAgentId(value: unknown): value is AgentId {
  return (
    typeof value === 'string' && value.length <= AGENT_ID_MAX_LENGTH && AGENT_ID_PATTERN.test(value)
  );
}

export function parseAgentId(value: unknown): AgentId {
  if (!isAgentId(value)) {
    throw new AgentIdentityError(
      'AGENT_ID_INVALID',
      'Agent ID must be 1-64 lowercase ASCII letters or digits, separated only by single hyphens or underscores.'
    );
  }

  return value;
}

export function defineAgentIdentity(input: AgentIdentityInput): AgentIdentity {
  const id = parseAgentId(input.id);
  const displayName = (input.displayName ?? id).trim();
  if (
    displayName.length === 0 ||
    displayName.length > DISPLAY_NAME_MAX_LENGTH ||
    containsControlCharacter(displayName)
  ) {
    throw new AgentIdentityError(
      'AGENT_DISPLAY_NAME_INVALID',
      'Agent display name must contain 1-128 characters and no control characters.'
    );
  }

  return Object.freeze({ id, displayName });
}
