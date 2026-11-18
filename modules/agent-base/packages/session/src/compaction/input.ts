import { AgentSessionError } from '../errors.js';
import { parseSessionBranchId, parseSessionId } from '../identifiers.js';
import type { CompactSessionInput } from './contracts.js';
import { defineSessionCompactionTarget } from './planning/target.js';
import { compactionRecord } from './planning/validation.js';

/** Validate data descriptors before reading values; detach and freeze the business input. */
export function defineCompactSessionInput(input: unknown): CompactSessionInput {
  const record = compactionRecord(input, ['sessionId', 'branchId', 'target'], 'Compaction input');
  const sessionId = Object.hasOwn(record, 'sessionId') ? record.sessionId : undefined;
  const branchId = Object.hasOwn(record, 'branchId') ? record.branchId : undefined;
  const target = Object.hasOwn(record, 'target') ? record.target : undefined;
  if (typeof sessionId !== 'string' || (branchId !== undefined && typeof branchId !== 'string')) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Compaction input must contain a sessionId string and an optional branchId string.'
    );
  }
  return Object.freeze({
    sessionId: parseSessionId(sessionId),
    ...(branchId === undefined ? {} : { branchId: parseSessionBranchId(branchId) }),
    ...(target === undefined ? {} : { target: defineSessionCompactionTarget(target) }),
  });
}
