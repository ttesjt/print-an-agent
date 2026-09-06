import { randomUUID } from 'node:crypto';
import { defineAssistantModelMessage, type ModelMessage } from '@ta-agent/base-model';
import {
  AgentSessionError,
  DEFAULT_SESSION_BRANCH_ID,
  completedLineageBeforeTurn,
  completedLineageForBranch,
  parseSessionFailureCode,
  parseSessionId,
  type ActiveSessionTurn,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type BeginSessionTurnRequest,
  type CommitSessionCompactionRequest,
  type CompactableSessionPort,
  type CompleteSessionTurnRequest,
  type CompletedSessionTurn,
  type FailSessionTurnRequest,
  type InspectableSessionPort,
  type LoadSessionHistoryRequest,
  type NavigableSessionPort,
  type ResolveSessionRequest,
  type ResolvedSessionReference,
  type SessionCompaction,
  type SessionBranchId,
  type SessionBranchReference,
  type SessionContextSnapshot,
  type SessionReference,
  type SessionSnapshot,
  type SessionTurn,
  type TurnId,
} from '@ta-agent/base-session';
import {
  cloneMemoryCompaction,
  cloneMemoryContext,
  cloneMemoryTurn,
  completedMemoryMessages,
  createMemorySessionSnapshot,
  memorySessionKey,
  readMemoryClock,
  resolveMemorySessionReference,
  validateMemoryContext,
  type StoredMemoryBranch,
  type StoredMemorySession,
} from './session-state.js';
import { applyMemorySessionNavigation } from './session-navigation.js';

export interface MemorySessionAdapterOptions {
  readonly createSessionId?: () => string;
  readonly createBranchId?: () => string;
  readonly clock?: () => number;
}

export class MemorySessionAdapter
  implements InspectableSessionPort, CompactableSessionPort, NavigableSessionPort
{
  readonly #sessions = new Map<string, StoredMemorySession>();
  readonly #createSessionId: () => string;
  readonly #createBranchId: () => string;
  readonly #clock: () => number;

  constructor(options: MemorySessionAdapterOptions | (() => string) = {}) {
    const normalized = typeof options === 'function' ? { createSessionId: options } : options;
    this.#createSessionId = normalized.createSessionId ?? randomUUID;
    this.#createBranchId = normalized.createBranchId ?? randomUUID;
    this.#clock = normalized.clock ?? Date.now;
  }

  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference> {
    return Promise.resolve().then(() => {
      const sessionId = parseSessionId(request.requestedSessionId ?? this.#createSessionId());
      const key = memorySessionKey(request.agentId, sessionId);
      let session = this.#sessions.get(key);
      if (session === undefined) {
        session = {
          agentId: request.agentId,
          sessionId,
          branches: new Map([
            [
              DEFAULT_SESSION_BRANCH_ID,
              {
                branchId: DEFAULT_SESSION_BRANCH_ID,
                createdAt: readMemoryClock(this.#clock),
              },
            ],
          ]),
          turns: [],
          compactions: new Map(),
          selectedBranchId: DEFAULT_SESSION_BRANCH_ID,
          navigationRevision: 0,
        };
        this.#sessions.set(key, session);
      }
      return resolveMemorySessionReference(session);
    });
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      if (
        request.navigationRevision !== session.navigationRevision ||
        request.branchId !== session.selectedBranchId
      ) {
        throw new AgentSessionError(
          'SESSION_NAVIGATION_CONFLICT',
          'Session selection changed before the request turn began.'
        );
      }
      const branch = this.#requireBranch(session, request.branchId);
      if (session.turns.some((turn) => turn.turnId === request.turnId)) {
        throw new AgentSessionError(
          'TURN_ALREADY_EXISTS',
          `Turn "${request.turnId}" already exists in session "${request.sessionId}".`
        );
      }
      if (
        session.turns.some((turn) => turn.status === 'active' && turn.branchId === request.branchId)
      ) {
        throw new AgentSessionError(
          'SESSION_BRANCH_BUSY',
          `Session branch "${request.branchId}" already has an active turn.`
        );
      }
      const turn: ActiveSessionTurn = Object.freeze({
        status: 'active',
        turnId: request.turnId,
        branchId: request.branchId,
        ...(branch.headTurnId === undefined ? {} : { parentTurnId: branch.headTurnId }),
        userMessage: Object.freeze({ ...request.userMessage }),
      });
      session.turns.push(turn);
      return cloneMemoryTurn(turn);
    });
  }

  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]> {
    return Promise.resolve().then(() =>
      completedMemoryMessages(
        completedLineageBeforeTurn(
          createMemorySessionSnapshot(this.#requireSession(request)),
          request.beforeTurnId
        )
      )
    );
  }

  loadContext(request: LoadSessionHistoryRequest): Promise<SessionContextSnapshot> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      const snapshot = createMemorySessionSnapshot(session);
      const beforeTurn = this.#requireTurn(session, request.beforeTurnId);
      const lineage = completedLineageBeforeTurn(snapshot, request.beforeTurnId);
      const compaction = session.compactions.get(beforeTurn.branchId);
      const boundaryIndex =
        compaction === undefined
          ? -1
          : lineage.findIndex((turn) => turn.turnId === compaction.throughTurnId);
      const useCompaction = compaction !== undefined && boundaryIndex >= 0;
      return Object.freeze({
        agentId: session.agentId,
        sessionId: session.sessionId,
        branchId: beforeTurn.branchId,
        ...(useCompaction ? { compaction: cloneMemoryCompaction(compaction) } : {}),
        messages: Object.freeze([
          ...(useCompaction ? [cloneMemoryContext(compaction.context)] : []),
          ...completedMemoryMessages(lineage.slice(useCompaction ? boundaryIndex + 1 : 0)),
        ]),
      });
    });
  }

  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      const index = this.#requireTurnIndex(session, request.turnId);
      const current = session.turns[index];
      if (current?.status !== 'active') {
        throw new AgentSessionError(
          'TURN_STATE_INVALID',
          `Turn "${request.turnId}" cannot complete from state "${current?.status ?? 'missing'}".`
        );
      }
      const branch = this.#requireBranch(session, current.branchId);
      if (branch.headTurnId !== current.parentTurnId) {
        throw new AgentSessionError(
          'SESSION_NAVIGATION_CONFLICT',
          'Session branch head changed before the active turn completed.'
        );
      }
      const completed: CompletedSessionTurn = Object.freeze({
        status: 'completed',
        turnId: current.turnId,
        branchId: current.branchId,
        ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
        userMessage: current.userMessage,
        assistantMessage: defineAssistantModelMessage(request.assistantMessage),
      });
      session.turns[index] = completed;
      branch.headTurnId = completed.turnId;
      session.navigationRevision += 1;
      return cloneMemoryTurn(completed);
    });
  }

  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn> {
    return Promise.resolve().then(() => {
      const failureCode = parseSessionFailureCode(request.failureCode);
      const session = this.#requireSession(request);
      const index = this.#requireTurnIndex(session, request.turnId);
      const current = session.turns[index];
      if (current === undefined) {
        throw new AgentSessionError('TURN_NOT_FOUND', `Turn "${request.turnId}" does not exist.`);
      }
      if (current.status !== 'active') return cloneMemoryTurn(current);
      const failed: SessionTurn = Object.freeze({
        status: 'failed',
        turnId: current.turnId,
        branchId: current.branchId,
        ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
        userMessage: current.userMessage,
        failureCode,
      });
      session.turns[index] = failed;
      return cloneMemoryTurn(failed);
    });
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
      return session === undefined ? undefined : createMemorySessionSnapshot(session);
    });
  }

  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      return applyMemorySessionNavigation(session, request, this.#createBranchId, this.#clock);
    });
  }

  readCompaction(reference: SessionBranchReference): Promise<SessionCompaction | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(reference);
      this.#requireBranch(session, reference.branchId);
      const compaction = session.compactions.get(reference.branchId);
      return compaction === undefined ? undefined : cloneMemoryCompaction(compaction);
    });
  }

  commitCompaction(request: CommitSessionCompactionRequest): Promise<SessionCompaction> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      this.#requireBranch(session, request.branchId);
      const current = session.compactions.get(request.branchId);
      const currentRevision = current?.revision ?? 0;
      if (request.expectedRevision !== currentRevision) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_CONFLICT',
          `Session compaction expected revision ${request.expectedRevision} but found ${currentRevision}.`
        );
      }
      const lineage = completedLineageForBranch(
        createMemorySessionSnapshot(session),
        request.branchId
      );
      const throughIndex = lineage.findIndex((turn) => turn.turnId === request.throughTurnId);
      if (throughIndex < 0) {
        throw new AgentSessionError(
          'SESSION_COMPACTION_INVALID',
          'Session compaction boundary must be a completed ancestor of its branch head.'
        );
      }
      if (current !== undefined) {
        const previousIndex = lineage.findIndex((turn) => turn.turnId === current.throughTurnId);
        if (previousIndex < 0 || throughIndex <= previousIndex) {
          throw new AgentSessionError(
            'SESSION_COMPACTION_CONFLICT',
            'Session compaction boundary must advance the current branch projection.'
          );
        }
      }
      const committed = Object.freeze({
        agentId: session.agentId,
        sessionId: session.sessionId,
        branchId: request.branchId,
        revision: currentRevision + 1,
        throughTurnId: request.throughTurnId,
        context: validateMemoryContext(request.context),
      });
      session.compactions.set(request.branchId, committed);
      return cloneMemoryCompaction(committed);
    });
  }

  #requireSession(reference: SessionReference): StoredMemorySession {
    const session = this.#sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
    if (session === undefined) {
      throw new AgentSessionError(
        'SESSION_NOT_FOUND',
        `Session "${reference.sessionId}" does not exist for agent "${reference.agentId}".`
      );
    }
    return session;
  }

  #requireBranch(session: StoredMemorySession, branchId: SessionBranchId): StoredMemoryBranch {
    const branch = session.branches.get(branchId);
    if (branch === undefined) {
      throw new AgentSessionError(
        'SESSION_BRANCH_NOT_FOUND',
        `Session branch "${branchId}" does not exist in session "${session.sessionId}".`
      );
    }
    return branch;
  }

  #requireTurn(session: StoredMemorySession, turnId: TurnId): SessionTurn {
    const turn = session.turns.find((candidate) => candidate.turnId === turnId);
    if (turn === undefined) {
      throw new AgentSessionError(
        'TURN_NOT_FOUND',
        `Turn "${turnId}" does not exist in session "${session.sessionId}".`
      );
    }
    return turn;
  }

  #requireTurnIndex(session: StoredMemorySession, turnId: TurnId): number {
    const index = session.turns.findIndex((turn) => turn.turnId === turnId);
    if (index < 0) this.#requireTurn(session, turnId);
    return index;
  }
}
