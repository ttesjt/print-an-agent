import { parseAgentId } from '@print-an-agent/base-identity-config/identity';
import {
  authorityBoundary,
  authorityField,
  authorityRecord,
} from '../validation/authority-record.js';
import { parseSessionId } from './identifiers.js';
import type { SessionReference } from './types/session-reference.js';

export const REFERENCE_FIELDS = ['agentId', 'sessionId'];

export function referenceFields(record: object): SessionReference {
  return Object.freeze({
    agentId: parseAgentId(authorityField(record, 'agentId')),
    sessionId: parseSessionId(authorityField(record, 'sessionId')),
  });
}

export function normalizeSessionReference(input: unknown): SessionReference {
  return authorityBoundary('SESSION_LIFECYCLE_INVALID', () =>
    referenceFields(authorityRecord(input, REFERENCE_FIELDS))
  );
}
