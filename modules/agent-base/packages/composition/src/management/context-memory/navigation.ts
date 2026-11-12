import { createHash } from 'node:crypto';
import {
  AgentSessionError,
  isCompletedAncestor,
  parseSessionBranchId,
  parseTurnId,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type InspectableSessionPort,
  type SessionMemoryNavigationPort,
  type SessionMemoryRecord,
  type SessionReference,
  type MutatingSessionNavigationCommand,
  type AgentSessionErrorCode,
} from '@print-an-agent/base-session';
import {
  assertReceiptMatches,
  canonicalJson,
  jsonValue,
  parseMemoryForkRequest,
  findContextMemoryCommit,
  parseMemoryReceipt,
} from '@print-an-agent/context-memory';
import { MemoryJournal, memoryObject, memoryString, payload, version } from './journal.js';
import type { ContextMemoryWorkflows } from './service.js';
import { hasSessionMemoryCleanupFailure } from './failures.js';
import { SessionMemoryCommitError } from './mutations.js';

export interface MemoryNavigationResources {
  readonly authorityId: string;
  readonly session: Pick<InspectableSessionPort, 'inspect'> & SessionMemoryNavigationPort;
  readonly memory: ContextMemoryWorkflows;
}

function terminalNavigationCode(value: unknown): AgentSessionErrorCode | undefined {
  switch (value) {
    case 'SESSION_BRANCH_ALREADY_EXISTS':
    case 'SESSION_BRANCH_NOT_FOUND':
    case 'SESSION_NAVIGATION_CONFLICT':
    case 'SESSION_NAVIGATION_TARGET_INVALID':
    case 'SESSION_NAVIGATION_INVALID':
      return value;
    default:
      return undefined;
  }
}

function rejectionCode(state: Record<string, unknown>): AgentSessionErrorCode | undefined {
  return (
    terminalNavigationCode(state.rejected) ??
    (state.skippedReason === undefined ? undefined : 'SESSION_MEMORY_NOT_CONFIGURED')
  );
}

export function isSettledNavigationRejection(row: SessionMemoryRecord, cause: unknown): boolean {
  const state = payload(row);
  return (
    row.settled &&
    state.cleanupPending !== true &&
    !hasSessionMemoryCleanupFailure(cause) &&
    cause instanceof AgentSessionError &&
    rejectionCode(state) === cause.code
  );
}

function rejectedNavigation(state: Record<string, unknown>): AgentSessionError {
  const code = rejectionCode(state);
  if (code === undefined)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation rejection.');
  const cause = new AgentSessionError(code, 'Session navigation was not published.');
  if (state.receipt !== undefined)
    return new SessionMemoryCommitError(
      { status: 'committed', receipt: parseMemoryReceipt(state.receipt) },
      cause,
      code
    );
  if (state.skippedReason !== undefined)
    return new SessionMemoryCommitError({ status: 'not-committed' }, cause, code);
  return cause;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation revision.');
  return value;
}
function command(value: unknown): MutatingSessionNavigationCommand {
  const data = memoryObject(value);
  const expectedRevision = revision(data.expectedRevision);
  if (data.operation === 'select')
    return { operation: 'select', branchId: parseSessionBranchId(data.branchId), expectedRevision };
  const target =
    data.newBranchId === undefined ? {} : { newBranchId: parseSessionBranchId(data.newBranchId) };
  if (data.operation === 'fork')
    return {
      operation: 'fork',
      sourceBranchId: parseSessionBranchId(data.sourceBranchId),
      throughTurnId: parseTurnId(data.throughTurnId),
      expectedRevision,
      ...target,
    };
  if (data.operation === 'rewind')
    return {
      operation: 'rewind',
      throughTurnId: parseTurnId(data.throughTurnId),
      expectedRevision,
      ...target,
    };
  throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation command.');
}
function applied(value: unknown, reference: SessionReference): AppliedSessionNavigation {
  const data = memoryObject(value);
  const nav = memoryObject(data.navigation);
  if (
    nav.agentId !== reference.agentId ||
    nav.sessionId !== reference.sessionId ||
    !Array.isArray(nav.branches) ||
    !['fork', 'rewind', 'select'].includes(String(data.operation))
  )
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation receipt.');
  const operation = data.operation;
  if (operation !== 'fork' && operation !== 'rewind' && operation !== 'select')
    throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Invalid navigation operation.');
  return {
    operation,
    affectedBranchId: parseSessionBranchId(data.affectedBranchId),
    navigation: {
      agentId: reference.agentId,
      sessionId: reference.sessionId,
      revision: revision(nav.revision),
      selectedBranchId: parseSessionBranchId(nav.selectedBranchId),
      branches: nav.branches.map((raw: unknown) => {
        const b = memoryObject(raw);
        return {
          branchId: parseSessionBranchId(b.branchId),
          createdAt: revision(b.createdAt),
          ...(b.parentBranchId === undefined
            ? {}
            : { parentBranchId: parseSessionBranchId(b.parentBranchId) }),
          ...(b.forkedFromTurnId === undefined
            ? {}
            : { forkedFromTurnId: parseTurnId(b.forkedFromTurnId) }),
          ...(b.headTurnId === undefined ? {} : { headTurnId: parseTurnId(b.headTurnId) }),
        };
      }),
    },
  };
}

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

export async function navigateWithMemory(
  resources: MemoryNavigationResources,
  request: ApplySessionNavigationRequest
): Promise<AppliedSessionNavigation> {
  const signal = request.signal ?? new AbortController().signal;
  const journal = new MemoryJournal(resources.session, request);
  const requested = command(request.command);
  const id = `navigation:${createHash('sha256')
    .update(canonicalJson(jsonValue(requested)))
    .digest('hex')}`;
  const previous = await journal.read('navigation', id);
  if (previous !== undefined) return publishMemoryNavigation(resources, journal, previous, signal);
  signal.throwIfAborted();
  const snapshot = await resources.session.inspect(request);
  if (snapshot === undefined)
    throw new AgentSessionError('SESSION_NOT_FOUND', 'Session not found.');
  if (snapshot.navigation.revision !== requested.expectedRevision)
    throw new AgentSessionError(
      'SESSION_NAVIGATION_CONFLICT',
      'Session navigation revision changed.'
    );
  if (snapshot.turns.some((turn) => turn.status === 'active'))
    throw new AgentSessionError('SESSION_BUSY', 'Session has an active Turn.');
  let normalized = requested;
  let fork: unknown;
  if (requested.operation === 'select') {
    const binding = await journal.read('binding', requested.branchId);
    if (!binding?.settled || payload(binding).authorityId !== resources.authorityId)
      throw new AgentSessionError(
        'SESSION_MEMORY_NOT_CONFIGURED',
        'Branch has no settled Memory binding.'
      );
  } else {
    const targetBranchId = requested.newBranchId ?? parseSessionBranchId(crypto.randomUUID());
    if (snapshot.navigation.branches.some((branch) => branch.branchId === targetBranchId))
      throw new AgentSessionError('SESSION_BRANCH_ALREADY_EXISTS', 'Target branch already exists.');
    const sourceBranch =
      requested.operation === 'fork'
        ? requested.sourceBranchId
        : snapshot.navigation.selectedBranchId;
    if (!isCompletedAncestor(snapshot, sourceBranch, requested.throughTurnId))
      throw new AgentSessionError(
        'SESSION_NAVIGATION_TARGET_INVALID',
        'Fork target is not a completed ancestor.'
      );
    const cp = await journal.read('turn', requested.throughTurnId);
    if (!cp?.settled)
      throw new AgentSessionError(
        'SESSION_MEMORY_NOT_CONFIGURED',
        'Turn has no settled Memory checkpoint.'
      );
    const source = version(payload(cp).final);
    const sourceBinding = await journal.read('binding', memoryString(payload(cp).branchId));
    if (
      !sourceBinding?.settled ||
      payload(sourceBinding).authorityId !== resources.authorityId ||
      payload(sourceBinding).memoryId !== source.memoryId
    )
      throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Checkpoint authority differs.');
    normalized = {
      ...requested,
      newBranchId: targetBranchId,
    };
    fork = { memoryId: `runtime:${crypto.randomUUID()}`, requestId: id, source };
  }
  signal.throwIfAborted();
  let row: SessionMemoryRecord;
  try {
    row = await journal.put(
      'navigation',
      id,
      {
        authorityId: resources.authorityId,
        command: normalized,
        ...(fork === undefined ? {} : { fork }),
      },
      false
    );
  } catch (cause) {
    if (cause instanceof AgentSessionError && cause.code === 'SESSION_MEMORY_CONFLICT') {
      const winner = await journal.read('navigation', id);
      if (winner !== undefined) return publishMemoryNavigation(resources, journal, winner, signal);
    }
    throw cause;
  }
  return publishMemoryNavigation(resources, journal, row, signal);
}
