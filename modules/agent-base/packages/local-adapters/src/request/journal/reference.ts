import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  parseRequestIdempotencyKey,
  type RequestJournalReference,
} from '@print-an-agent/base-request';
import { parseSessionId } from '@print-an-agent/base-session';

export function normalizeJournalReference(
  reference: RequestJournalReference
): RequestJournalReference {
  return Object.freeze({
    agentId: parseAgentId(reference.agentId),
    sessionId: parseSessionId(reference.sessionId),
    idempotencyKey: parseRequestIdempotencyKey(reference.idempotencyKey),
  });
}
