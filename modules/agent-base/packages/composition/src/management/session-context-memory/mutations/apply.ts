import { AgentSessionError } from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  ContextMemoryError,
  findContextMemoryCommit,
  requestDigest,
  type MemoryReceipt,
} from '@print-an-agent/context-memory';
import { SessionMemoryCommitError } from '../errors.js';
import { hasSessionMemoryCleanupFailure } from '../failures.js';
import { payload } from '../journal.js';
import { applyInput } from './input.js';
import { recordMemoryReceipt } from './receipt.js';
import { replayRuntimeMemory } from './replay.js';
import type { RuntimeMemoryMutation } from './types.js';

export async function applyRuntimeMemory(options: RuntimeMemoryMutation): Promise<string> {
  const { journal, memory, input, signal } = options;
  const { request } = applyInput(input);
  let intent = await journal.read('mutation', input.requestId);
  if (intent !== undefined) return replayRuntimeMemory(options, intent, request);
  signal.throwIfAborted();
  try {
    intent = await journal.put(
      'mutation',
      input.requestId,
      {
        authorityId: options.authorityId,
        branchId: options.branchId,
        turnId: options.turnId,
        scope: options.turnId === undefined ? 'management' : 'turn',
        input,
        inputDigest: requestDigest(request),
      },
      false
    );
  } catch (cause) {
    if (cause instanceof AgentSessionError && cause.code === 'SESSION_MEMORY_CONFLICT') {
      const winner = await journal.read('mutation', input.requestId);
      if (winner !== undefined) return replayRuntimeMemory(options, winner, request);
    }
    throw cause;
  }
  let invoked = false;
  let skippedReason: string | undefined;
  let returnedReceipt: MemoryReceipt | undefined;
  try {
    signal.throwIfAborted();
    invoked = true;
    const result = await memory.apply.run({ input, signal });
    if (result.status === 'skipped') {
      skippedReason = result.reason;
      await journal.put('mutation', intent.id, { ...payload(intent), skippedReason }, true, intent);
      return JSON.stringify(result);
    }
    assertReceiptMatches(result.receipt, request);
    returnedReceipt = result.receipt;
    await recordMemoryReceipt(journal, intent, result.receipt);
    return JSON.stringify(result);
  } catch (cause) {
    const evidence = findContextMemoryCommit(cause, (commit) => {
      if (commit.status !== 'committed')
        return (
          commit.status === 'unknown' &&
          commit.memoryId === input.memoryId &&
          commit.requestId === input.requestId
        );
      try {
        assertReceiptMatches(commit.receipt, request);
        return true;
      } catch {
        return false;
      }
    });
    const known =
      returnedReceipt ?? (evidence?.status === 'committed' ? evidence.receipt : undefined);
    if (hasSessionMemoryCleanupFailure(cause)) {
      const commit =
        skippedReason !== undefined
          ? { status: 'not-committed' as const }
          : known === undefined
            ? { status: 'unknown' as const, memoryId: input.memoryId, requestId: input.requestId }
            : { status: 'committed' as const, receipt: known };
      try {
        const current = await journal.read('mutation', intent.id);
        if (current !== undefined) {
          intent = await journal.put(
            'mutation',
            intent.id,
            {
              ...payload(current),
              cleanupPending: true,
              ...(skippedReason === undefined ? {} : { skippedReason }),
              ...(known === undefined ? {} : { receipt: known }),
            },
            false,
            current
          );
          if (known !== undefined) await recordMemoryReceipt(journal, intent, known);
        }
      } catch (coordination) {
        throw new SessionMemoryCommitError(commit, new AggregateError([cause, coordination]));
      }
      throw new SessionMemoryCommitError(commit, cause);
    }
    if (skippedReason !== undefined) {
      try {
        await journal.put(
          'mutation',
          intent.id,
          { ...payload(intent), skippedReason },
          true,
          intent
        );
      } catch (coordination) {
        throw new SessionMemoryCommitError(
          { status: 'not-committed' },
          new AggregateError([cause, coordination])
        );
      }
      throw new SessionMemoryCommitError({ status: 'not-committed' }, cause);
    }
    if (known !== undefined) {
      try {
        await recordMemoryReceipt(journal, intent, known);
      } catch (coordination) {
        throw new SessionMemoryCommitError(
          { status: 'committed', receipt: known },
          new AggregateError([cause, coordination])
        );
      }
      throw new SessionMemoryCommitError({ status: 'committed', receipt: known }, cause);
    }
    if (
      !invoked ||
      (cause instanceof ContextMemoryError &&
        cause.memoryId === input.memoryId &&
        cause.commit?.status === 'not-committed')
    ) {
      const data = payload(intent);
      const code =
        cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
          ? cause.code
          : 'OPERATION_ABORTED';
      await journal.put('mutation', intent.id, { ...data, code }, true, intent);
      if (signal.aborted) throw cause;
      return JSON.stringify({ status: 'rejected', code });
    }
    throw new SessionMemoryCommitError(
      { status: 'unknown', memoryId: input.memoryId, requestId: input.requestId },
      cause
    );
  }
}
