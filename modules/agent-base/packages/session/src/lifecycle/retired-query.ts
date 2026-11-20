import { parseAgentId } from '@print-an-agent/base-identity';
import { parseSessionId } from '../contracts/index.js';
import { DEFAULT_SESSION_QUERY_LIMIT, MAX_SESSION_QUERY_LIMIT } from '../query/index.js';
import {
  authorityBoundary,
  authorityField,
  authorityInteger,
  authorityRecord,
  invalidAuthority,
  optionalAuthorityField,
} from '../validation/authority-record.js';
import type { NormalizedListRetiredSessionsInput } from './types/query.js';

export function normalizeListRetiredSessionsInput(
  input: unknown
): NormalizedListRetiredSessionsInput {
  return authorityBoundary('SESSION_QUERY_INVALID', () => {
    const record = authorityRecord(input, ['agentId'], ['limit', 'cursor']);
    const requestedLimit = optionalAuthorityField(record, 'limit');
    const limit = authorityInteger(
      requestedLimit === undefined ? DEFAULT_SESSION_QUERY_LIMIT : requestedLimit
    );
    if (limit < 1 || limit > MAX_SESSION_QUERY_LIMIT) return invalidAuthority();
    const cursorInput = optionalAuthorityField(record, 'cursor');
    const base = { agentId: parseAgentId(authorityField(record, 'agentId')), limit };
    if (cursorInput === undefined) return Object.freeze(base);
    const cursor = authorityRecord(cursorInput, ['retiredAt', 'sessionId']);
    return Object.freeze({
      ...base,
      cursor: Object.freeze({
        retiredAt: authorityInteger(authorityField(cursor, 'retiredAt')),
        sessionId: parseSessionId(authorityField(cursor, 'sessionId')),
      }),
    });
  });
}
