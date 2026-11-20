import {
  AgentSessionError,
  type AppliedSessionNavigation,
  type SessionMemoryRecord,
} from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  findContextMemoryCommit,
  parseMemoryForkRequest,
  parseMemoryReceipt,
} from '@print-an-agent/context-memory';
import { SessionMemoryCommitError } from '../errors.js';
import { hasSessionMemoryCleanupFailure } from '../failures.js';
import { MemoryJournal, payload } from '../journal.js';
import { rejectedNavigation, terminalNavigationCode } from './failures.js';
import { command } from './input.js';
import { applied } from './receipt.js';
import type { MemoryNavigationResources } from './types.js';

/** An intent fixes target identity before crossing authorities. No latest-head or model fallback. */
export async function publishMemoryNavigation(
  resources: MemoryNavigationResources,
  journal: MemoryJournal,
  row: SessionMemoryRecord,
  signal: AbortSignal
): Promise<AppliedSessionNavigation> {
  const state = payload(row);
  if (state.authorityId !== resources.authorityId)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Navigation Memory authority differs.');
  if (row.settled) {
    if (state.rejected !== undefined) throw rejectedNavigation(state);
    return applied(state.applied, journal.reference);
  }
  const mutation = command(state.command);
  const forkIdentity =
    mutation.operation === 'select' ? undefined : parseMemoryForkRequest(state.fork);
  let receipt = state.receipt === undefined ? undefined : parseMemoryReceipt(state.receipt);
  if (receipt !== undefined && forkIdentity !== undefined)
    assertReceiptMatches(receipt, forkIdentity.request);
  if (state.cleanupPending === true) {
    const cause = new AgentSessionError(
      'SESSION_MEMORY_CLEANUP_FAILED',
      'Navigation cleanup is unconfirmed.'
    );
    if (receipt !== undefined)
      throw new SessionMemoryCommitError({ status: 'committed', receipt }, cause);
    throw cause;
  }
  let publicationAttempted = false;
  try {
    signal.throwIfAborted();
    let publication = row;
    let binding: { id: string; value: string } | undefined;
    if (mutation.operation !== 'select') {
      const { input, request } = parseMemoryForkRequest(state.fork);
      if (receipt === undefined) {
        const result = await resources.memory.fork.run({ input, signal });
        if (result.status === 'skipped') {
          const rejected = {
            ...state,
            rejected: 'SESSION_MEMORY_NOT_CONFIGURED',
            skippedReason: result.reason,
          };
          await journal.put('navigation', row.id, rejected, true, row);
          throw rejectedNavigation(rejected);
        }
        assertReceiptMatches(result.receipt, request);
        receipt = result.receipt;
        publication = await journal.put('navigation', row.id, { ...state, receipt }, false, row);
      }
      if (mutation.newBranchId === undefined)
        throw new AgentSessionError(
          'SESSION_MEMORY_INVALID',
          'Navigation target identity is missing.'
        );
      binding = {
        id: mutation.newBranchId,
        value: JSON.stringify({
          format: 1,
          authorityId: resources.authorityId,
          memoryId: input.memoryId,
          origin: input.source,
        }),
      };
    }
    // After a Memory commit cancellation leaves this durable intent for explicit reconciliation.
    signal.throwIfAborted();
    publicationAttempted = true;
    return await resources.session.publishMemoryNavigation({
      ...journal.reference,
      command: mutation,
      intentId: row.id,
      expectedIntentRevision: publication.revision,
      ...(binding === undefined ? {} : { binding }),
    });
  } catch (cause) {
    const identity = forkIdentity;
    if (receipt === undefined && identity !== undefined) {
      const commit = findContextMemoryCommit(cause, (candidate) => {
        if (candidate.status !== 'committed') return false;
        try {
          assertReceiptMatches(candidate.receipt, identity.request);
          return true;
        } catch {
          return false;
        }
      });
      if (commit?.status === 'committed') receipt = commit.receipt;
    }
    const commit = receipt !== undefined ? { status: 'committed' as const, receipt } : undefined;
    const cleanupFailed = hasSessionMemoryCleanupFailure(cause);
    if (cleanupFailed) {
      try {
        const current = await journal.read('navigation', row.id);
        if (current !== undefined)
          await journal.put(
            'navigation',
            row.id,
            {
              ...payload(current),
              cleanupPending: true,
              ...(receipt === undefined ? {} : { receipt }),
            },
            false,
            current
          );
      } catch (coordination) {
        if (commit !== undefined)
          throw new SessionMemoryCommitError(commit, new AggregateError([cause, coordination]));
        throw new AggregateError(
          [cause, coordination],
          'Navigation cleanup and coordination failed.'
        );
      }
    }
    if (
      !cleanupFailed &&
      publicationAttempted &&
      cause instanceof AgentSessionError &&
      terminalNavigationCode(cause.code) !== undefined
    ) {
      let rejected: Record<string, unknown>;
      try {
        const current = await journal.read('navigation', row.id);
        if (current === undefined)
          throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Navigation intent is missing.');
        if (current.settled) {
          const saved = payload(current);
          if (saved.rejected === undefined) return applied(saved.applied, journal.reference);
          rejected = saved;
        } else {
          rejected = {
            ...payload(current),
            rejected: cause.code,
            ...(receipt === undefined ? {} : { receipt }),
          };
          await journal.put('navigation', row.id, rejected, true, current);
        }
      } catch (coordination) {
        if (commit !== undefined)
          throw new SessionMemoryCommitError(commit, new AggregateError([cause, coordination]));
        throw coordination;
      }
      throw rejectedNavigation(rejected);
    }
    if (commit !== undefined) throw new SessionMemoryCommitError(commit, cause);
    throw cause;
  }
}
