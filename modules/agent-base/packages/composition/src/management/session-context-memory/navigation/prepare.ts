import {
  AgentSessionError,
  isCompletedAncestor,
  parseSessionBranchId,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type SessionMemoryRecord,
} from '@print-an-agent/base-session';
import { canonicalJson, jsonValue } from '@print-an-agent/context-memory';
import { createHash } from 'node:crypto';
import { MemoryJournal, memoryString, payload, version } from '../journal.js';
import { command } from './input.js';
import { publishMemoryNavigation } from './publish.js';
import type { MemoryNavigationResources } from './types.js';

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
