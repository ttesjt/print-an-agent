import type { AgentId } from '@print-an-agent/base-identity-config/identity';
import {
  AgentSessionError,
  MAX_SESSION_COMPACTION_CHARACTERS,
  completedLineageForBranch,
  type ActiveSessionTurn,
  type CompletedSessionTurn,
  type ResolvedSessionReference,
  type SessionBranchId,
  type SessionBranchSnapshot,
  type SessionCompaction,
  type SessionExecutionId,
  type SessionExecutionLease,
  type SessionId,
  type SessionLifecycleState,
  type SessionSnapshot,
  type SessionTurn,
  type SessionTurnPresentation,
  type TurnId,
} from '@print-an-agent/base-session';
import {
  defineAssistantModelMessage,
  type ContextModelMessage,
  type ModelMessage,
} from '@print-an-agent/model-invocation-core';

export interface StoredMemoryBranch {
  readonly branchId: SessionBranchId;
  readonly parentBranchId?: SessionBranchId;
  readonly forkedFromTurnId?: TurnId;
  readonly createdAt: number;
  headTurnId?: TurnId;
}

export interface StoredMemorySession {
  readonly memoryRecords: Map<string, import('@print-an-agent/base-session').SessionMemoryRecord>;
  lifecycle: SessionLifecycleState;
  executionRevision: number;
  executionState: 'ready' | 'recovering';
  readonly executions: Map<SessionExecutionId, SessionExecutionLease>;
  readonly agentId: AgentId;
  readonly sessionId: SessionId;
  readonly createdAt: number;
  readonly branches: Map<SessionBranchId, StoredMemoryBranch>;
  readonly turns: SessionTurn[];
  readonly presentations: Map<TurnId, SessionTurnPresentation>;
  readonly compactions: Map<SessionBranchId, SessionCompaction>;
  title?: string;
  metadataRevision: number;
  metadataUpdatedAt: number;
  updatedAt: number;
  selectedBranchId: SessionBranchId;
  navigationRevision: number;
}

export function memorySessionKey(agentId: AgentId, sessionId: SessionId): string {
  return `${agentId}\u0000${sessionId}`;
}

export function cloneMemoryTurn(turn: ActiveSessionTurn): ActiveSessionTurn;

export function cloneMemoryTurn(turn: CompletedSessionTurn): CompletedSessionTurn;

export function cloneMemoryTurn(turn: SessionTurn): SessionTurn;

export function cloneMemoryTurn(turn: SessionTurn): SessionTurn {
  if (turn.status === 'completed') {
    return Object.freeze({
      ...turn,
      userMessage: Object.freeze({ ...turn.userMessage }),
      assistantMessage: defineAssistantModelMessage(turn.assistantMessage),
    });
  }
  return Object.freeze({ ...turn, userMessage: Object.freeze({ ...turn.userMessage }) });
}

export function cloneMemoryContext(message: ContextModelMessage): ContextModelMessage {
  return Object.freeze({ ...message });
}

export function cloneMemoryCompaction(compaction: SessionCompaction): SessionCompaction {
  return Object.freeze({ ...compaction, context: cloneMemoryContext(compaction.context) });
}

export function validateMemoryContext(message: ContextModelMessage): ContextModelMessage {
  if (
    message.role !== 'context' ||
    typeof message.text !== 'string' ||
    message.text.length === 0 ||
    message.text.length > MAX_SESSION_COMPACTION_CHARACTERS ||
    !Number.isSafeInteger(message.timestamp) ||
    message.timestamp < 0
  ) {
    throw new AgentSessionError(
      'SESSION_COMPACTION_OUTPUT_INVALID',
      'Session compaction context message is invalid.'
    );
  }
  return cloneMemoryContext(message);
}

export function readMemoryClock(clock: () => number): number {
  const timestamp = clock();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new AgentSessionError(
      'SESSION_CONFIGURATION_INVALID',
      'Session clock must return a non-negative safe integer.'
    );
  }
  return timestamp;
}

export function touchMemorySession(session: StoredMemorySession, timestamp: number): void {
  session.updatedAt = Math.max(session.updatedAt, timestamp);
}

function cloneMemoryBranch(branch: StoredMemoryBranch): SessionBranchSnapshot {
  return Object.freeze({ ...branch });
}

export function completedMemoryMessages(
  turns: readonly CompletedSessionTurn[]
): readonly ModelMessage[] {
  return Object.freeze(
    turns.flatMap<ModelMessage>((turn) => {
      const clone = cloneMemoryTurn(turn);
      return [clone.userMessage, clone.assistantMessage];
    })
  );
}

export function createMemorySessionSnapshot(session: StoredMemorySession): SessionSnapshot {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    navigation: Object.freeze({
      agentId: session.agentId,
      sessionId: session.sessionId,
      revision: session.navigationRevision,
      selectedBranchId: session.selectedBranchId,
      branches: Object.freeze([...session.branches.values()].map(cloneMemoryBranch)),
    }),
    turns: Object.freeze(session.turns.map(cloneMemoryTurn)),
  });
}

export function resolveMemorySessionReference(
  session: StoredMemorySession
): ResolvedSessionReference {
  return Object.freeze({
    agentId: session.agentId,
    sessionId: session.sessionId,
    branchId: session.selectedBranchId,
    navigationRevision: session.navigationRevision,
  });
}

export function inheritMemoryCompaction(
  session: StoredMemorySession,
  snapshot: SessionSnapshot,
  sourceBranchId: SessionBranchId,
  targetBranchId: SessionBranchId,
  throughTurnId: TurnId
): void {
  const source = session.compactions.get(sourceBranchId);
  if (source === undefined) return;
  const lineage = completedLineageForBranch(snapshot, sourceBranchId);
  const boundaryIndex = lineage.findIndex((turn) => turn.turnId === source.throughTurnId);
  const forkIndex = lineage.findIndex((turn) => turn.turnId === throughTurnId);
  if (boundaryIndex < 0 || forkIndex < boundaryIndex) return;
  session.compactions.set(
    targetBranchId,
    Object.freeze({
      ...source,
      branchId: targetBranchId,
      revision: 1,
      context: cloneMemoryContext(source.context),
    })
  );
}
