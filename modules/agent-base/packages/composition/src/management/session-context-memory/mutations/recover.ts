import { AgentSessionError, type SessionMemoryRecord } from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  findContextMemoryCommit,
  type MemoryReceipt,
} from '@print-an-agent/context-memory';
import { SessionMemoryCommitError } from '../errors.js';
import { hasSessionMemoryCleanupFailure } from '../failures.js';
import { MemoryJournal, memoryObject, payload } from '../journal.js';
import type { ContextMemoryWorkflows } from '../types/workflows.js';
import { rejectUnconfirmedCleanup } from './cleanup.js';
import { applyInput } from './input.js';
import { recordMemoryReceipt } from './receipt.js';

export async function recoverMemoryMutation(
  journal: MemoryJournal,
  row: SessionMemoryRecord,
  memory: ContextMemoryWorkflows,
  authorityId: string,
  signal: AbortSignal
) {
  const data = payload(row);
  if (data.authorityId !== authorityId)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Recovery authority differs.');
  const { input, request } = applyInput(memoryObject(data.input));
  rejectUnconfirmedCleanup(data, request);
  if (data.skippedReason !== undefined) {
    if (typeof data.skippedReason !== 'string')
      throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid skipped Memory result.');
    await journal.put('mutation', row.id, data, true, row);
    return { status: 'skipped' as const, reason: data.skippedReason };
  }
  let receipt: MemoryReceipt | undefined;
  try {
    receipt = await memory.getReceipt.run({
      input: { memoryId: input.memoryId, requestId: input.requestId },
      signal,
    });
  } catch (cause) {
    const evidence = findContextMemoryCommit(cause, (commit) => {
      if (commit.status !== 'committed') return false;
      try {
        assertReceiptMatches(commit.receipt, request);
        return true;
      } catch {
        return false;
      }
    });
    const commit =
      evidence?.status === 'committed'
        ? evidence
        : {
            status: 'unknown' as const,
            memoryId: input.memoryId,
            requestId: input.requestId,
          };
    try {
      const current = await journal.read('mutation', row.id);
      if (current !== undefined) {
        const pending = hasSessionMemoryCleanupFailure(cause)
          ? await journal.put(
              'mutation',
              row.id,
              {
                ...payload(current),
                cleanupPending: true,
                ...(commit.status === 'committed' ? { receipt: commit.receipt } : {}),
              },
              false,
              current
            )
          : current;
        if (commit.status === 'committed')
          await recordMemoryReceipt(journal, pending, commit.receipt);
      }
    } catch (coordination) {
      throw new SessionMemoryCommitError(commit, new AggregateError([cause, coordination]));
    }
    throw new SessionMemoryCommitError(commit, cause);
  }
  if (receipt === undefined)
    throw new SessionMemoryCommitError({
      status: 'unknown',
      memoryId: input.memoryId,
      requestId: input.requestId,
    });
  assertReceiptMatches(receipt, request);
  await recordMemoryReceipt(journal, row, receipt);
  return receipt;
}
