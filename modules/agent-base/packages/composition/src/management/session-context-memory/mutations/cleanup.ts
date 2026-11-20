import { AgentSessionError } from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  parseMemoryReceipt,
  type MutationRequest,
} from '@print-an-agent/context-memory';
import { SessionMemoryCommitError } from '../errors.js';

export function rejectUnconfirmedCleanup(
  data: Record<string, unknown>,
  request: MutationRequest
): void {
  if (data.cleanupPending !== true) return;
  const receipt = data.receipt === undefined ? undefined : parseMemoryReceipt(data.receipt);
  if (receipt !== undefined) assertReceiptMatches(receipt, request);
  throw new SessionMemoryCommitError(
    data.skippedReason !== undefined
      ? { status: 'not-committed' }
      : receipt === undefined
        ? { status: 'unknown', memoryId: request.memoryId, requestId: request.requestId }
        : { status: 'committed', receipt },
    new AgentSessionError('SESSION_MEMORY_CLEANUP_FAILED', 'Memory cleanup is unconfirmed.')
  );
}
