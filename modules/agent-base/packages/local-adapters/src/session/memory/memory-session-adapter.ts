import { randomUUID } from 'node:crypto';
import { type ModelMessage } from '@ta-agent/base-model';
import {
  AgentSessionError,
  defineSessionTurnPresentation,
  type SessionPresentationPort,
  type SessionTurnPresentation,
  type SessionTurnPresentationReference,
  type SessionTurnPresentationRecord,
  type CompleteSessionTurnWithPresentationRequest,
  DEFAULT_SESSION_BRANCH_ID,
  completedLineageBeforeTurn,
  completedLineageForBranch,
  parseSessionFailureCode,
  parseSessionId,
  normalizeRenameSessionInput,
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
  type SessionInspection,
  type SessionListPage,
  type SessionMetadataPort,
  type SessionQueryPort,
  type SessionTurnPage,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type SessionTurn,
  type RenameSessionInput,
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
  touchMemorySession,
  validateMemoryContext,
  type StoredMemoryBranch,
  type StoredMemorySession,
} from './session-state.js';
import { completeMemorySessionTurn } from './session-completion.js';
import { applyMemorySessionNavigation } from './session-navigation.js';
import {
  inspectMemorySession,
  listMemorySessions,
  listMemorySessionTurns,
} from './session-query.js';

export interface MemorySessionAdapterOptions {
  readonly createSessionId?: () => string;
  readonly createBranchId?: () => string;
  readonly clock?: () => number;
}

export class MemorySessionAdapter
  implements
    InspectableSessionPort,
    CompactableSessionPort,
    NavigableSessionPort,
    SessionQueryPort,
    SessionPresentationPort,
    SessionMetadataPort
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
        const timestamp = readMemoryClock(this.#clock);
        session = {
          agentId: request.agentId,
          sessionId,
          createdAt: timestamp,
          branches: new Map([
            [
              DEFAULT_SESSION_BRANCH_ID,
              {
                branchId: DEFAULT_SESSION_BRANCH_ID,
                createdAt: timestamp,
              },
            ],
          ]),
          turns: [],
          presentations: new Map(),
          compactions: new Map(),
          metadataRevision: 0,
          metadataUpdatedAt: timestamp,
          updatedAt: timestamp,
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
      const updatedAt = readMemoryClock(this.#clock);
      session.turns.push(turn);
      touchMemorySession(session, updatedAt);
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
    return this.#completeTurn(request);
  }

  completeTurnWithPresentation(
    request: CompleteSessionTurnWithPresentationRequest
  ): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() =>
      this.#completeTurn(request, defineSessionTurnPresentation(request.presentation))
    );
  }

  readTurnPresentation(
    reference: SessionTurnPresentationReference
  ): Promise<SessionTurnPresentationRecord | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
      const presentation = session?.presentations.get(reference.turnId);
      if (presentation === undefined || session === undefined) return undefined;
      const turn = this.#requireTurn(session, reference.turnId);
      return Object.freeze({
        agentId: session.agentId,
        sessionId: session.sessionId,
        turnId: turn.turnId,
        branchId: turn.branchId,
        presentation: defineSessionTurnPresentation(presentation),
      });
    });
  }

  #completeTurn(
    request: CompleteSessionTurnRequest,
    presentation?: SessionTurnPresentation
  ): Promise<CompletedSessionTurn> {
    return Promise.resolve().then(() =>
      completeMemorySessionTurn(this.#requireSession(request), request, this.#clock, presentation)
    );
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
      const updatedAt = readMemoryClock(this.#clock);
      const failed: SessionTurn = Object.freeze({
        status: 'failed',
        turnId: current.turnId,
        branchId: current.branchId,
        ...(current.parentTurnId === undefined ? {} : { parentTurnId: current.parentTurnId }),
        userMessage: current.userMessage,
        failureCode,
      });
      session.turns[index] = failed;
      touchMemorySession(session, updatedAt);
      return cloneMemoryTurn(failed);
    });
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
      return session === undefined ? undefined : createMemorySessionSnapshot(session);
    });
  }

  listSessions(input: ListSessionsInput): Promise<SessionListPage> {
    return Promise.resolve().then(() => listMemorySessions(this.#sessions, input));
  }

  inspectSession(reference: SessionReference): Promise<SessionInspection | undefined> {
    return Promise.resolve().then(() => inspectMemorySession(this.#sessions, reference));
  }

  listSessionTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined> {
    return Promise.resolve().then(() => listMemorySessionTurns(this.#sessions, input));
  }

  renameSession(input: RenameSessionInput): Promise<SessionInspection> {
    return Promise.resolve().then(() => {
      const request = normalizeRenameSessionInput(input);
      const session = this.#requireSession(request);
      if (session.metadataRevision !== request.expectedRevision) {
        throw new AgentSessionError(
          'SESSION_METADATA_CONFLICT',
          `Session metadata expected revision ${request.expectedRevision} but found ${session.metadataRevision}.`
        );
      }
      session.title = request.title;
      session.metadataRevision += 1;
      session.metadataUpdatedAt = Math.max(session.metadataUpdatedAt, readMemoryClock(this.#clock));
      const renamed = inspectMemorySession(this.#sessions, request);
      if (renamed === undefined)
        throw new AgentSessionError('SESSION_NOT_FOUND', 'Session missing.');
      return renamed;
    });
  }

  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation> {
    return Promise.resolve().then(() => {
      const session = this.#requireSession(request);
      return applyMemorySessionNavigation(
        session,
        request,
        this.#createBranchId,
        readMemoryClock(this.#clock)
      );
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
      const updatedAt = readMemoryClock(this.#clock);
      session.compactions.set(request.branchId, committed);
      touchMemorySession(session, updatedAt);
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
