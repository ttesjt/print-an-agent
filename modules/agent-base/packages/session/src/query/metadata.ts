import { parseAgentId } from '@ta-agent/base-identity';

import { AgentSessionError } from '../errors.js';
import { parseSessionId } from '../identifiers.js';
import type { RenameSessionInput } from './contracts.js';

export const MAX_SESSION_TITLE_CHARACTERS = 120;

export function normalizeSessionTitle(input: unknown): string {
  if (typeof input !== 'string') throw invalidTitle();
  const title = input.trim();
  if (
    title.length === 0 ||
    title.length > MAX_SESSION_TITLE_CHARACTERS ||
    containsControlCharacter(title)
  ) {
    throw invalidTitle();
  }
  return title;
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function normalizeRenameSessionInput(input: RenameSessionInput): RenameSessionInput {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new AgentSessionError(
      'SESSION_METADATA_INVALID',
      'Session metadata expected revision must be a non-negative safe integer.'
    );
  }
  return Object.freeze({
    agentId: parseAgentId(input.agentId),
    sessionId: parseSessionId(input.sessionId),
    title: normalizeSessionTitle(input.title),
    expectedRevision: input.expectedRevision,
  });
}

function invalidTitle(): AgentSessionError {
  return new AgentSessionError(
    'SESSION_METADATA_INVALID',
    `Session title must contain 1-${MAX_SESSION_TITLE_CHARACTERS} characters without control characters.`
  );
}
