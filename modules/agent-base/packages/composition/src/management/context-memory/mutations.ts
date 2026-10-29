import {
  AgentSessionError,
  type AgentSessionErrorCode,
  type SessionMemoryRecord,
} from '@ta-agent/base-session';
import {
  assertReceiptMatches,
  parseDeterministicMemoryRequest,
  parseItemCommands,
  requestDigest,
  findContextMemoryCommit,
  ContextMemoryError,
  type ApplyMemoryInput,
  type MemoryReceipt,
  type MutationRequest,
  parseMemoryReceipt,
} from '@ta-agent/context-memory';
import { MemoryJournal, memoryObject, memoryString, payload, version } from './journal.js';
import type { ContextMemoryWorkflows } from './service.js';
import { hasSessionMemoryCleanupFailure } from './failures.js';

export class SessionMemoryCommitError extends AgentSessionError {
  constructor(
    readonly commit:
      | { readonly status: 'committed'; readonly receipt: MemoryReceipt }
      | { readonly status: 'not-committed' }
      | { readonly status: 'unknown'; readonly memoryId: string; readonly requestId: string },
    cause?: unknown,
    code: AgentSessionErrorCode = 'SESSION_MEMORY_PENDING'
  ) {
    super(
      hasSessionMemoryCleanupFailure(cause) ? 'SESSION_MEMORY_CLEANUP_FAILED' : code,
      commit.status === 'committed'
        ? 'Memory committed; coordination or post-processing failed.'
        : commit.status === 'not-committed'
          ? 'Memory was not committed; post-processing failed.'
          : 'Memory outcome is unresolved; recover the original receipt.',
      { cause }
    );
  }
}

function rejectUnconfirmedCleanup(data: Record<string, unknown>, request: MutationRequest): void {
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

export function applyInput(value: unknown): { input: ApplyMemoryInput; request: MutationRequest } {
  const { data, request } = parseDeterministicMemoryRequest('apply', value);
  if (
    typeof data.expectedRevision !== 'number' ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 1
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid expected Memory revision.');
  return {
    request,
    input: {
      memoryId: request.memoryId,
      requestId: request.requestId,
      expectedRevision: data.expectedRevision,
      commands: parseItemCommands(data.commands),
    },
  };
}
export async function recordMemoryReceipt(
  journal: MemoryJournal,
  row: SessionMemoryRecord,
  receipt: MemoryReceipt
) {
  const data = payload(row);
  const original = applyInput(data.input);
  assertReceiptMatches(receipt, original.request);
  if (data.inputDigest !== requestDigest(original.request))
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory intent digest is invalid.');
  // A crash between these writes is recoverable: keep the intent pending until its checkpoint is written.
  if (data.scope !== 'management') {
    const turnId = memoryString(data.turnId);
    const cp = await journal.read('turn', turnId);
    if (cp === undefined) throw new SessionMemoryCommitError({ status: 'committed', receipt });
    const state = payload(cp);
    const previous = version(state.final);
    if (previous.memoryId !== receipt.memoryId)
      throw new AgentSessionError(
        'SESSION_MEMORY_INVALID',
        'Receipt does not belong to this Turn binding.'
      );
    if (receipt.revision > previous.revision)
      await journal.put(
        'turn',
        turnId,
        { ...state, final: { memoryId: receipt.memoryId, revision: receipt.revision } },
        false,
        cp
      );
  }
  await journal.put('mutation', row.id, { ...data, receipt }, data.cleanupPending !== true, row);
}

interface RuntimeMemoryMutation {
  journal: MemoryJournal;
  memory: ContextMemoryWorkflows;
  authorityId: string;
  turnId?: string;
  branchId: string;
  input: ApplyMemoryInput;
  signal: AbortSignal;
}

async function replayRuntimeMemory(
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
