import type { SessionBranchId, SessionSnapshot } from '../contracts/index.js';
import { AgentSessionError } from '../errors.js';
import { completedLineageForBranch } from '../lineage.js';
import { validateSessionCompactionPolicy } from './policy.js';
import type { SessionCompactionPolicy } from './types/policy.js';
import type { SessionCompaction } from './types/projection.js';
import type { SessionCompactionSource } from './types/source.js';

export type SessionCompactionSelection =
  | Readonly<{ status: 'selected'; source: SessionCompactionSource }>
  | Readonly<{
      status: 'skipped';
      reason: 'not-enough-completed-turns' | 'no-new-completed-turns';
    }>;

function completedTurnsAfterBoundary(
  snapshot: SessionSnapshot,
  branchId: SessionBranchId,
  compaction: SessionCompaction | undefined
) {
  const lineage = completedLineageForBranch(snapshot, branchId);
  let boundaryIndex = -1;
  if (compaction !== undefined) {
    boundaryIndex = lineage.findIndex((turn) => turn.turnId === compaction.throughTurnId);
    if (boundaryIndex < 0) {
      throw new AgentSessionError(
        'SESSION_RECORD_INVALID',
        'Session compaction boundary does not identify a completed authoritative turn.'
      );
    }
  }
  return lineage.slice(boundaryIndex + 1);
}

function turnCharacters(turn: ReturnType<typeof completedTurnsAfterBoundary>[number]): number {
  return turn.userMessage.text.length + turn.assistantMessage.text.length;
}

export function selectSessionCompactionSource(
  snapshot: SessionSnapshot,
  branchId: SessionBranchId,
  compaction: SessionCompaction | undefined,
  policy: SessionCompactionPolicy
): SessionCompactionSelection {
  const validatedPolicy = validateSessionCompactionPolicy(policy);
  if (
    compaction !== undefined &&
    (compaction.agentId !== snapshot.agentId ||
      compaction.sessionId !== snapshot.sessionId ||
      compaction.branchId !== branchId ||
      !Number.isSafeInteger(compaction.revision) ||
      compaction.revision < 1)
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_INVALID',
      'Session compaction state does not belong to the authoritative Session snapshot.'
    );
  }
  const newCompletedTurns = completedTurnsAfterBoundary(snapshot, branchId, compaction);
  if (newCompletedTurns.length === 0) {
    return Object.freeze({ status: 'skipped', reason: 'no-new-completed-turns' });
  }
  if (newCompletedTurns.length < validatedPolicy.minimumCompletedTurns) {
    return Object.freeze({ status: 'skipped', reason: 'not-enough-completed-turns' });
  }

  const eligibleEnd =
    validatedPolicy.retainRecentTurns === 0 ? undefined : -validatedPolicy.retainRecentTurns;
  const eligible = newCompletedTurns.slice(0, eligibleEnd);
  const turns: typeof eligible = [];
  let sourceCharacters = 0;
  for (const turn of eligible) {
    if (turns.length >= validatedPolicy.maxSourceTurns) break;
    const characters = turnCharacters(turn);
    if (sourceCharacters + characters > validatedPolicy.maxSourceCharacters) {
      if (turns.length === 0) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_SOURCE_LIMIT_EXCEEDED',
          `The next completed turn exceeds the ${validatedPolicy.maxSourceCharacters} character compaction source budget.`
        );
      }
      break;
    }
    turns.push(turn);
    sourceCharacters += characters;
  }

  const throughTurn = turns.at(-1);
  if (throughTurn === undefined) {
    return Object.freeze({ status: 'skipped', reason: 'not-enough-completed-turns' });
  }
  return Object.freeze({
    status: 'selected',
    source: Object.freeze({
      agentId: snapshot.agentId,
      sessionId: snapshot.sessionId,
      branchId,
      expectedRevision: compaction?.revision ?? 0,
      ...(compaction === undefined ? {} : { previousContext: compaction.context }),
      turns: Object.freeze(turns),
      throughTurnId: throughTurn.turnId,
      sourceCharacters,
    }),
  });
}
