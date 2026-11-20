import { AgentSessionError, type SessionMemoryRecord } from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  parseMemoryReceipt,
  requestDigest,
  type MutationRequest,
} from '@print-an-agent/context-memory';
import { memoryString, payload } from '../journal.js';
import { rejectUnconfirmedCleanup } from './cleanup.js';
import { recoverMemoryMutation } from './recover.js';
import type { RuntimeMemoryMutation } from './types.js';

export async function replayRuntimeMemory(
  options: RuntimeMemoryMutation,
  intent: SessionMemoryRecord,
  request: MutationRequest
): Promise<string> {
  const { journal, memory, signal } = options;
  const data = payload(intent);
  if (
    data.inputDigest !== requestDigest(request) ||
    data.authorityId !== options.authorityId ||
    data.branchId !== options.branchId ||
    data.turnId !== options.turnId
  )
    throw new AgentSessionError(
      'SESSION_MEMORY_CONFLICT',
      'Tool request was reused with different input.'
    );
  rejectUnconfirmedCleanup(data, request);
  if (intent.settled && data.receipt !== undefined) {
    const receipt = parseMemoryReceipt(data.receipt);
    assertReceiptMatches(receipt, request);
    return JSON.stringify({ status: receipt.status, receipt });
  }
  if (intent.settled && data.skippedReason !== undefined) {
    if (typeof data.skippedReason !== 'string')
      throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid skipped Memory result.');
    return JSON.stringify({ status: 'skipped', reason: data.skippedReason });
  }
  if (intent.settled) return JSON.stringify({ status: 'rejected', code: memoryString(data.code) });
  // Do not invoke an unresolved write again automatically.
  const receipt = await recoverMemoryMutation(journal, intent, memory, options.authorityId, signal);
  return JSON.stringify(
    receipt.status === 'skipped' ? receipt : { status: receipt.status, receipt }
  );
}
