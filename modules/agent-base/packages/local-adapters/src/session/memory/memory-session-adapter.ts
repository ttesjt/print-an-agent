import type {
  SessionExecutionFence,
  SessionLifecycleSnapshot,
  SessionMemoryRecord,
} from '@print-an-agent/base-session';
import {
  AgentSessionError,
  type ActiveSessionTurn,
  type AppliedSessionNavigation,
  type ApplySessionNavigationRequest,
  type BeginSessionTurnRequest,
  type CommitSessionCompactionRequest,
  type CompactableSessionPort,
  type CompleteSessionTurnRequest,
  type CompleteSessionTurnWithPresentationRequest,
  type CompletedSessionTurn,
  type FailSessionTurnRequest,
  type InspectableSessionPort,
  type ListRetiredSessionsInput,
  type ListSessionTurnsInput,
  type ListSessionsInput,
  type LoadSessionHistoryRequest,
  type NavigableSessionPort,
  type PublishSessionMemoryNavigation,
  type PurgeSessionInput,
  type RecoverSessionExecutionsInput,
  type RenameSessionInput,
  type ResolveSessionRequest,
  type ResolvedSessionReference,
  type RetiredSessionListPage,
  type SessionBranchReference,
  type SessionCompaction,
  type SessionContextSnapshot,
  type SessionExecutionLease,
  type SessionInspection,
  type SessionLifecycleInspection,
  type SessionLifecycleListPage,
  type SessionLifecycleMutationInput,
  type SessionMemoryRecordKey,
  type SessionMetadataPort,
  type SessionPresentationPort,
  type SessionQueryPort,
  type SessionReference,
  type SessionSnapshot,
  type SessionTurn,
  type SessionTurnPage,
  type SessionTurnPresentationRecord,
  type SessionTurnPresentationReference,
  type WriteSessionMemoryRecord,
} from '@print-an-agent/base-session';
import type { ModelMessage } from '@print-an-agent/model-invocation-core';
import { commitMemorySessionCompaction } from './compaction.js';
import { memorySessionCoordination } from './coordination.js';
import { loadMemoryContext, loadMemoryHistory } from './history.js';
import { MemorySessionLifecycle } from './lifecycle/authority.js';
import { advanceMemoryExecution, memoryExecutionFence } from './lifecycle/state.js';
import { publishMemorySessionNavigation } from './memory-coordination/navigation.js';
import {
  listPendingMemoryCoordinationRecords,
  readMemoryCoordinationRecord,
  writeMemoryCoordinationRecord,
} from './memory-coordination/records.js';
import { renameMemorySession } from './metadata.js';
import { applyMemorySessionNavigation } from './navigation/apply.js';
import {
  inspectMemorySession,
  listMemorySessionTurns,
  listMemorySessions,
  listRetiredMemorySessions,
} from './query.js';
import { resolveMemorySession } from './resolution.js';
import { readMemoryClock } from './state/clock.js';
import { cloneMemoryCompaction } from './state/cloning.js';
import { createMemorySessionState } from './state/create-state.js';
import { memorySessionKey, requireMemoryBranch, requireMemorySession } from './state/lookup.js';
import { createMemorySessionSnapshot } from './state/snapshot.js';
import {
  beginMemoryTurn,
  completeMemoryTurn,
  completeMemoryTurnWithPresentation,
  failMemoryTurn,
} from './turns/mutations.js';
import { readMemoryTurnPresentation } from './turns/presentation.js';
import type { MemorySessionCoordination } from './types/coordination.js';
import type { MemorySessionAdapterOptions } from './types/options.js';
import type { MemorySessionState } from './types/state.js';

export class MemorySessionAdapter
  implements
    InspectableSessionPort,
    CompactableSessionPort,
    NavigableSessionPort,
    SessionQueryPort,
    SessionPresentationPort,
    SessionMetadataPort
{
  readonly #state: MemorySessionState;
  readonly #lifecycle: MemorySessionLifecycle;

  /** @internal Coordination authority belongs only to the local persistence factory. */
  [memorySessionCoordination](): MemorySessionCoordination {
    return {
      assertWrite: (
        request: SessionReference & import('@print-an-agent/base-session').SessionWriteAuthority
      ) => {
        this.#lifecycle.assertWrite(request);
      },
      checkpoint: (reference: SessionReference) => {
        const copy = structuredClone(this.#lifecycle.require(reference));
        return () => {
          this.#state.sessions.set(memorySessionKey(copy.agentId, copy.sessionId), copy);
          this.#state.sessionIds.add(copy.sessionId);
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
    this.#state = createMemorySessionState(normalized);
    this.#lifecycle = new MemorySessionLifecycle(this.#state.sessions, this.#state.clock);
  }

  resolve(request: ResolveSessionRequest): Promise<ResolvedSessionReference> {
    return resolveMemorySession(this.#state, this.#lifecycle, request);
  }

  beginTurn(request: BeginSessionTurnRequest): Promise<ActiveSessionTurn> {
    return beginMemoryTurn(this.#state, this.#lifecycle, request);
  }

  loadHistory(request: LoadSessionHistoryRequest): Promise<readonly ModelMessage[]> {
    return loadMemoryHistory(this.#state, request);
  }

  loadContext(request: LoadSessionHistoryRequest): Promise<SessionContextSnapshot> {
    return loadMemoryContext(this.#state, request);
  }

  completeTurn(request: CompleteSessionTurnRequest): Promise<CompletedSessionTurn> {
    return completeMemoryTurn(this.#state, this.#lifecycle, request);
  }

  completeTurnWithPresentation(
    request: CompleteSessionTurnWithPresentationRequest
  ): Promise<CompletedSessionTurn> {
    return completeMemoryTurnWithPresentation(this.#state, this.#lifecycle, request);
  }

  readTurnPresentation(
    reference: SessionTurnPresentationReference
  ): Promise<SessionTurnPresentationRecord | undefined> {
    return readMemoryTurnPresentation(this.#state, reference);
  }

  failTurn(request: FailSessionTurnRequest): Promise<SessionTurn> {
    return failMemoryTurn(this.#state, this.#lifecycle, request);
  }

  readMemoryRecord(input: SessionMemoryRecordKey): Promise<SessionMemoryRecord | undefined> {
    return readMemoryCoordinationRecord(this.#state, this.#lifecycle, input);
  }

  listPendingMemoryRecords(ref: SessionReference): Promise<SessionMemoryRecord[]> {
    return listPendingMemoryCoordinationRecords(this.#state, this.#lifecycle, ref);
  }

  writeMemoryRecord(input: WriteSessionMemoryRecord): Promise<SessionMemoryRecord> {
    return writeMemoryCoordinationRecord(this.#state, this.#lifecycle, input);
  }

  inspect(reference: SessionReference): Promise<SessionSnapshot | undefined> {
    return Promise.resolve().then(() => {
      const session = this.#state.sessions.get(
        memorySessionKey(reference.agentId, reference.sessionId)
      );
      return session === undefined ? undefined : createMemorySessionSnapshot(session);
    });
  }

  listSessions(input: ListSessionsInput): Promise<SessionLifecycleListPage> {
    return Promise.resolve().then(() => listMemorySessions(this.#state.sessions, input));
  }

  inspectSession(reference: SessionReference): Promise<SessionLifecycleInspection | undefined> {
    return Promise.resolve().then(() => {
      const summary = inspectMemorySession(this.#state.sessions, reference);
      return summary === undefined
        ? undefined
        : Object.freeze({
            ...summary,
            execution: memoryExecutionFence(this.#lifecycle.require(reference)),
          });
    });
  }

  listRetiredSessions(input: ListRetiredSessionsInput): Promise<RetiredSessionListPage> {
    return Promise.resolve().then(() => listRetiredMemorySessions(this.#state.sessions, input));
  }

  retireSession(input: SessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot> {
    return Promise.resolve().then(() => this.#lifecycle.transition(input, 'retire'));
  }

  restoreSession(input: SessionLifecycleMutationInput): Promise<SessionLifecycleSnapshot> {
    return Promise.resolve().then(() => this.#lifecycle.transition(input, 'restore'));
  }

  acquireSessionExecution(reference: SessionReference): Promise<SessionExecutionLease> {
    return Promise.resolve().then(() => this.#lifecycle.acquire(reference));
  }

  releaseSessionExecution(lease: SessionExecutionLease): Promise<void> {
    return Promise.resolve().then(() => this.#lifecycle.release(lease));
  }

  purgeSession(input: PurgeSessionInput): Promise<void> {
    return Promise.resolve().then(() => {
      this.#lifecycle.purge(input);
      this.#state.sessionIds.delete(input.sessionId);
    });
  }

  recoverSessionExecutions(input: RecoverSessionExecutionsInput): Promise<SessionExecutionFence> {
    return Promise.resolve().then(() => this.#lifecycle.recover(input));
  }

  listSessionTurns(input: ListSessionTurnsInput): Promise<SessionTurnPage | undefined> {
    return Promise.resolve().then(() => listMemorySessionTurns(this.#state.sessions, input));
  }

  renameSession(input: RenameSessionInput): Promise<SessionInspection> {
    return renameMemorySession(this.#state, input);
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
        this.#state.createBranchId,
        readMemoryClock(this.#state.clock)
      );
    });
  }

  publishMemoryNavigation(
    input: PublishSessionMemoryNavigation
  ): Promise<AppliedSessionNavigation> {
    return publishMemorySessionNavigation(this.#state, this.#lifecycle, input);
  }

  readCompaction(reference: SessionBranchReference): Promise<SessionCompaction | undefined> {
    return Promise.resolve().then(() => {
      const session = requireMemorySession(this.#state.sessions, reference);
      requireMemoryBranch(session, reference.branchId);
      const compaction = session.compactions.get(reference.branchId);
      return compaction === undefined ? undefined : cloneMemoryCompaction(compaction);
    });
  }

  commitCompaction(request: CommitSessionCompactionRequest): Promise<SessionCompaction> {
    return Promise.resolve().then(() => {
      const session = this.#lifecycle.assertWrite(request);
      requireMemoryBranch(session, request.branchId);
      return commitMemorySessionCompaction(session, request, this.#state.clock);
    });
  }
}
