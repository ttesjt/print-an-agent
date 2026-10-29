import { AgentSessionError, type SessionMemoryRecord } from '@ta-agent/base-session';
import {
  assertReceiptMatches,
  parseDeterministicMemoryRequest,
  parseMemoryForkRequest,
  findContextMemoryCommit,
  parseMemoryReceipt,
  type MemoryReceipt,
} from '@ta-agent/context-memory';
import { MemoryJournal, payload, memoryString, version } from './journal.js';
import { hasSessionMemoryCleanupFailure } from './failures.js';
import { SessionMemoryCommitError } from './mutations.js';
import type { SessionContextMemoryOptions } from './service.js';

export async function initializeSessionMemoryBinding(
  options: SessionContextMemoryOptions,
  journal: MemoryJournal,
  binding: SessionMemoryRecord,
  signal: AbortSignal
) {
  const state = payload(binding);
  if (state.authorityId !== options.authorityId)
    throw new AgentSessionError(
      'SESSION_MEMORY_INVALID',
      'Memory authority differs from the persisted binding.'
    );
  const memoryId = memoryString(state.memoryId);
  const requestId = `initialize:${memoryId}`;
  const input = { memoryId, requestId, config: { render: { format: 'json' as const } } };
  const fork =
    state.origin === undefined ? undefined : { memoryId, requestId, source: version(state.origin) };
  const request =
    fork === undefined
      ? parseDeterministicMemoryRequest('create', input).request
      : parseMemoryForkRequest(fork).request;
  if (state.cleanupPending === true) {
    const receipt = state.receipt === undefined ? undefined : parseMemoryReceipt(state.receipt);
    if (receipt !== undefined) assertReceiptMatches(receipt, request);
    throw new SessionMemoryCommitError(
      receipt === undefined
        ? { status: 'unknown', memoryId, requestId }
        : { status: 'committed', receipt },
      new AgentSessionError(
        'SESSION_MEMORY_CLEANUP_FAILED',
        'Initialization cleanup is unconfirmed.'
      )
    );
  }
  if (binding.settled) return binding;
  let receipt: MemoryReceipt | undefined;
  try {
    const result =
      fork === undefined
        ? await options.memory.create.run({ input, signal })
        : await options.memory.fork.run({ input: fork, signal });
    if (result.status === 'skipped')
      throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Memory initialization was skipped.');
    assertReceiptMatches(result.receipt, request);
    receipt = result.receipt;
    return await journal.put('binding', binding.id, state, true, binding);
  } catch (cause) {
    if (receipt === undefined) {
      const evidence = findContextMemoryCommit(cause, (commit) => {
        if (commit.status !== 'committed') return false;
        try {
          assertReceiptMatches(commit.receipt, request);
          return true;
        } catch {
          return false;
        }
      });
      if (evidence?.status === 'committed') receipt = evidence.receipt;
    }
    const commit =
      receipt === undefined
        ? { status: 'unknown' as const, memoryId, requestId }
        : { status: 'committed' as const, receipt };
    if (hasSessionMemoryCleanupFailure(cause)) {
      try {
        const current = await journal.read('binding', binding.id);
        if (current !== undefined)
          await journal.put(
            'binding',
            binding.id,
            {
              ...payload(current),
              cleanupPending: true,
              ...(receipt === undefined ? {} : { receipt }),
            },
            false,
            current
          );
      } catch (coordination) {
        throw new SessionMemoryCommitError(commit, new AggregateError([cause, coordination]));
      }
    }
    throw new SessionMemoryCommitError(commit, cause);
  }
}
