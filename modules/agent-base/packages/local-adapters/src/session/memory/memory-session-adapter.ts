import { randomUUID } from 'node:crypto';
import {
  decideMemoryRecord,
  memoryRecordKey,
  type SessionMemoryRecordKey,
  type WriteSessionMemoryRecord,
  type PublishSessionMemoryNavigation,
} from '@ta-agent/base-session';
import { parseAgentId } from '@ta-agent/base-identity';
import { type ModelMessage } from '@ta-agent/model-invocation-core';
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
  type SessionMetadataPort,
  type SessionQueryPort,
  type SessionTurnPage,
  type ListSessionsInput,
  type ListSessionTurnsInput,
  type SessionTurn,
  type RenameSessionInput,
  type TurnId,
  type SessionLifecycleMutationInput,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type SessionExecutionLease,
  type SessionLifecycleListPage,
  type SessionLifecycleInspection,
  type ListRetiredSessionsInput,
  type RetiredSessionListPage,
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
  type StoredMemoryBranch,
  type StoredMemorySession,
} from './session-state.js';
import { completeMemorySessionTurn } from './session-completion.js';
import { commitMemorySessionCompaction } from './session-compaction.js';
import {
  MemorySessionLifecycle,
  advanceMemoryExecution,
  memoryExecutionFence,
} from './session-lifecycle.js';
import { memorySessionCoordination } from '../../persistence/memory-coordination.js';
import { applyMemorySessionNavigation } from './session-navigation.js';
import {
  inspectMemorySession,
  listMemorySessions,
  listMemorySessionTurns,
  listRetiredMemorySessions,
} from './session-query.js';

export interface MemorySessionAdapterOptions {
  /** Must issue fresh, never-reused IDs, including across restarts of the owning application. */
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
  readonly #sessionIds = new Set<string>();
  readonly #createSessionId: () => string;
  readonly #createBranchId: () => string;
  readonly #clock: () => number;
  readonly #lifecycle: MemorySessionLifecycle;

  /** @internal Coordination authority belongs only to the local persistence factory. */
  [memorySessionCoordination]() {
    return {
      assertWrite: (
        request: SessionReference & import('@ta-agent/base-session').SessionWriteAuthority
      ) => {
        this.#lifecycle.assertWrite(request);
      },
      checkpoint: (reference: SessionReference) => {
        const copy = structuredClone(this.#lifecycle.require(reference));
        return () => {
          this.#sessions.set(memorySessionKey(copy.agentId, copy.sessionId), copy);
          this.#sessionIds.add(copy.sessionId);
        };
      },
      fenceRecovery: (reference: SessionReference) => {
        const session = this.#lifecycle.require(reference);
        advanceMemoryExecution(session);
        session.executionState = 'recovering';
        session.executions.clear();
      },
    };
  }

  constructor(options: MemorySessionAdapterOptions | (() => string) = {}) {
    const normalized = typeof options === 'function' ? { createSessionId: options } : options;
    this.#createSessionId = normalized.createSessionId ?? randomUUID;
    this.#createBranchId = normalized.createBranchId ?? randomUUID;
    this.#clock = normalized.clock ?? Date.now;
    this.#lifecycle = new MemorySessionLifecycle(this.#sessions, this.#clock);
  }

  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference> {
    return Promise.resolve().then(() => {
      const agentId = parseAgentId(request.agentId);
      if (request.sessionId !== undefined) {
        this.#lifecycle.assertOpen({ agentId, sessionId: parseSessionId(request.sessionId) });
        return resolveMemorySessionReference(
          this.#requireSession({
            agentId,
            sessionId: parseSessionId(request.sessionId),
          })
        );
      }
      const sessionId = parseSessionId(this.#createSessionId());
      const key = memorySessionKey(agentId, sessionId);
      if (this.#sessionIds.has(sessionId)) {
        throw new AgentSessionError(
          'SESSION_ID_CONFLICT',
          'Session ID generator returned an existing identity.'
        );
      }
      const timestamp = readMemoryClock(this.#clock);
      const session: StoredMemorySession = {
        memoryRecords: new Map(),
        lifecycle: { status: 'active' },
        executionRevision: 0,
        executionState: 'ready',
        executions: new Map(),
        agentId,
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
      this.#sessionIds.add(sessionId);
      return resolveMemorySessionReference(session);
    });
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return Promise.resolve().then(() => {
      const session = this.#lifecycle.assertWrite(request);
      if ([...session.memoryRecords.values()].some((record) => !record.settled))
        throw new AgentSessionError('SESSION_MEMORY_PENDING', 'Memory coordination is unsettled.');
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
      advanceMemoryExecution(session);
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
    return Promise.resolve().then(() => {
      const session = this.#lifecycle.assertWrite(request);
      const result = completeMemorySessionTurn(session, request, this.#clock, presentation);
      advanceMemoryExecution(session);
      return result;
    });
  }

  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn> {
    return Promise.resolve().then(() => {
      const failureCode = parseSessionFailureCode(request.failureCode);
      const session = this.#lifecycle.assertWrite(request);
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
      advanceMemoryExecution(session);
      touchMemorySession(session, updatedAt);
      return cloneMemoryTurn(failed);
    });
  }

  readMemoryRecord(input: SessionMemoryRecordKey) {
    return Promise.resolve().then(() => {
      const key = memoryRecordKey(input);
      return this.#lifecycle.require(key).memoryRecords.get(JSON.stringify([key.kind, key.id]));
    });
  }

  listPendingMemoryRecords(ref: SessionReference) {
    return Promise.resolve().then(() =>
      [...this.#lifecycle.require(ref).memoryRecords.values()]
        .filter((r) => !r.settled)
        .slice(0, 100)
    );
  }

  writeMemoryRecord(input: WriteSessionMemoryRecord) {
    return Promise.resolve().then(() => {
      const key = memoryRecordKey(input);
      const session =
        input.execution === undefined
          ? this.#lifecycle.require(key)
          : this.#lifecycle.assertWrite(input);
      if (
        input.execution === undefined &&
        (session.lifecycle.status !== 'active' ||
          session.executions.size !== 0 ||
          (session.executionState === 'recovering' && input.expectedRevision === null))
      )
        throw new AgentSessionError(
          'SESSION_BUSY',
          'Memory coordination requires an idle Session or its execution lease.'
        );
      const id = JSON.stringify([key.kind, key.id]);
      if (
        key.kind === 'navigation' &&
        input.expectedRevision === null &&
        (session.turns.some((turn) => turn.status === 'active') ||
          [...session.memoryRecords.values()].some((record) => !record.settled))
      )
        throw new AgentSessionError('SESSION_BUSY', 'Memory navigation requires an idle Session.');
      const next = decideMemoryRecord(session.memoryRecords.get(id), input);
      advanceMemoryExecution(session);
      session.memoryRecords.set(id, next);
      return next;
    });
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#sessions.get(memorySessionKey(reference.agentId, reference.sessionId));
      return session === undefined ? undefined : createMemorySessionSnapshot(session);
    });
  }

  listSessions(input: ListSessionsInput): Promise<SessionLifecycleListPage> {
    return Promise.resolve().then(() => listMemorySessions(this.#sessions, input));
  }

  inspectSession(reference: SessionReference): Promise<SessionLifecycleInspection | undefined> {
    return Promise.resolve().then(() => {
      const summary = inspectMemorySession(this.#sessions, reference);
      return summary === undefined
        ? undefined
        : Object.freeze({
            ...summary,
            execution: memoryExecutionFence(this.#lifecycle.require(reference)),
          });
    });
  }

  listRetiredSessions(input: ListRetiredSessionsInput): Promise<RetiredSessionListPage> {
    return Promise.resolve().then(() => listRetiredMemorySessions(this.#sessions, input));
  }

  retireSession(input: SessionLifecycleMutationInput) {
    return Promise.resolve().then(() => this.#lifecycle.transition(input, 'retire'));
  }

  restoreSession(input: SessionLifecycleMutationInput) {
    return Promise.resolve().then(() => this.#lifecycle.transition(input, 'restore'));
  }

  acquireSessionExecution(reference: SessionReference) {
    return Promise.resolve().then(() => this.#lifecycle.acquire(reference));
  }

  releaseSessionExecution(lease: SessionExecutionLease): Promise<void> {
    return Promise.resolve().then(() => this.#lifecycle.release(lease));
  }

  purgeSession(input: PurgeSessionInput): Promise<void> {
    return Promise.resolve().then(() => {
      this.#lifecycle.purge(input);
      this.#sessionIds.delete(input.sessionId);
    });
  }

  recoverSessionExecutions(input: RecoverSessionExecutionsInput) {
    return Promise.resolve().then(() => this.#lifecycle.recover(input));
  }

  listSessionTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined> {
    return Promise.resolve().then(() => listMemorySessionTurns(this.#sessions, input));
  }

  renameSession(input: RenameSessionInput): Promise<SessionInspection> {
    return Promise.resolve().then(() => {
      const request = normalizeRenameSessionInput(input);
      const session = this.#requireSession(request);
      if (session.executionState === 'recovering')
        throw new AgentSessionError('SESSION_BUSY', 'Session recovery is unsettled.');
      if (session.metadataRevision !== request.expectedRevision) {
        throw new AgentSessionError(
          'SESSION_METADATA_CONFLICT',
          `Session metadata expected revision ${request.expectedRevision} but found ${session.metadataRevision}.`
        );
      }
      const updatedAt = Math.max(session.metadataUpdatedAt, readMemoryClock(this.#clock));
      if (session.metadataRevision >= Number.MAX_SAFE_INTEGER) {
        throw new AgentSessionError(
          'SESSION_METADATA_INVALID',
          'Session metadata revision exhausted.'
        );
      }
      session.title = request.title;
      session.metadataRevision += 1;
      session.metadataUpdatedAt = updatedAt;
      const renamed = inspectMemorySession(this.#sessions, request);
      if (renamed === undefined)
        throw new AgentSessionError('SESSION_NOT_FOUND', 'Session missing.');
      return renamed;
    });
  }

  applyNavigation(request: ApplySessionNavigationRequest): Promise<AppliedSessionNavigation> {
    return Promise.resolve().then(() => {
      const session = this.#lifecycle.assertWrite(request);
      if ([...session.memoryRecords.values()].some((record) => record.kind === 'binding'))
        throw new AgentSessionError(
          'SESSION_MEMORY_NOT_CONFIGURED',
          'Use the Memory-aware navigation coordinator for this Session.'
        );
      return applyMemorySessionNavigation(
        session,
        request,
        this.#createBranchId,
        readMemoryClock(this.#clock)
      );
    });
  }

  publishMemoryNavigation(
    input: PublishSessionMemoryNavigation
  ): Promise<AppliedSessionNavigation> {
    return Promise.resolve().then(() => {
      const session =
        input.execution === undefined
          ? this.#lifecycle.require(input)
          : this.#lifecycle.assertWrite(input);
      if (
        session.lifecycle.status !== 'active' ||
        (input.execution === undefined && session.executions.size !== 0) ||
        session.turns.some((turn) => turn.status === 'active')
      )
        throw new AgentSessionError('SESSION_BUSY', 'Memory navigation requires an idle Session.');
      const key = JSON.stringify(['navigation', input.intentId]);
      const intent = session.memoryRecords.get(key);
      if (
        intent === undefined ||
        intent.settled ||
        intent.revision !== input.expectedIntentRevision
      )
        throw new AgentSessionError('SESSION_MEMORY_CONFLICT', 'Memory navigation intent changed.');
      const rollback = structuredClone(session);
      try {
        const applied = applyMemorySessionNavigation(
          session,
          input,
          this.#createBranchId,
          readMemoryClock(this.#clock)
        );
        if (input.binding !== undefined) {
          if (input.binding.id !== applied.affectedBranchId)
            throw new AgentSessionError('SESSION_MEMORY_INVALID', 'Memory binding branch differs.');
          const bindingKey = JSON.stringify(['binding', input.binding.id]);
          session.memoryRecords.set(
            bindingKey,
            decideMemoryRecord(session.memoryRecords.get(bindingKey), {
              ...input,
              kind: 'binding',
              id: input.binding.id,
              value: input.binding.value,
              expectedRevision: null,
              settled: true,
            })
          );
        }
        session.memoryRecords.set(
          key,
          decideMemoryRecord(intent, {
            ...input,
            kind: 'navigation',
            id: input.intentId,
            expectedRevision: intent.revision,
            settled: true,
            value: JSON.stringify({ ...(JSON.parse(intent.value) as object), applied }),
          })
        );
        advanceMemoryExecution(session);
        return applied;
      } catch (cause) {
        this.#sessions.set(memorySessionKey(session.agentId, session.sessionId), rollback);
        throw cause;
      }
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
      const session = this.#lifecycle.assertWrite(request);
      this.#requireBranch(session, request.branchId);
      return commitMemorySessionCompaction(session, request, this.#clock);
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
