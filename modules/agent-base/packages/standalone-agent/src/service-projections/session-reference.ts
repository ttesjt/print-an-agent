import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import { parseSessionId, type SessionReference } from '@print-an-agent/base-session';
import type { StandaloneSessionReferenceInput } from './types/session-reference.js';

export function projectSessionReference(
  input: StandaloneSessionReferenceInput
): Readonly<SessionReference> {
  return Object.freeze({
    agentId: parseAgentId(input.agentId),
    sessionId: parseSessionId(input.sessionId),
  });
}
