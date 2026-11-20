import { parseSessionBranchId, parseSessionId } from '../contracts/index.js';
import { AgentSessionError } from '../errors.js';
import { compactionRecord } from './input-validation.js';
import { defineSessionCompactionTarget } from './planning/target.js';
import type { CompactSessionInput } from './types/input.js';

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
