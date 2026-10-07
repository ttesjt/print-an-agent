import type { ConversationInteractionEvent, SessionRevision } from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { KeyedOperationOwnership } from '../application/operation-ownership.js';
import type { ConversationCommitTarget, ConversationManagementPort } from '../application/ports.js';
import type { SessionSelectionState } from '../session/use-session-management.js';
import {
  appendCompletedTurn,
  failHistoryPage,
  failHistoryRead,
  historyFromPage,
  historyTurns,
  prependHistoryPage,
  resolveHistoryRead,
  type ConversationHistoryState,
} from './conversation-history-state.js';
import {
  type ActiveInteractionState,
  ConversationStreamProtocolError,
  createSubmittingInteraction,
  failInteractionProtocol,
  isTerminalInteraction,
  markInteractionCancelling,
  reduceInteractionEvent,
} from './interaction-state.js';

interface DraftConversationTarget {
  readonly agentId: string;
  readonly kind: 'draft';
}

interface PersistedConversationTarget {
  readonly agentId: string;
  readonly branchId: string;
  readonly kind: 'persisted';
  readonly navigationRevision?: SessionRevision;
  readonly sessionId: string;
}

type ConversationTarget = DraftConversationTarget | PersistedConversationTarget;

interface ConversationEntry {
  readonly activeInteraction: ActiveInteractionState | undefined;
  readonly branchMutationError: string | undefined;
  readonly branchMutationTurnId: string | undefined;
  readonly composerValue: string;
  readonly historyState: ConversationHistoryState;
  readonly target: ConversationTarget;
}

export function useConversationManagement(input: {
  readonly agentId: string | undefined;
  readonly management: ConversationManagementPort;
  readonly onConversationCommitted: (target: ConversationCommitTarget) => void;
  readonly onNavigationChanged: (target: Readonly<{ agentId: string; sessionId: string }>) => void;
  readonly sessionState: SessionSelectionState;
}) {
  const { agentId, management, onConversationCommitted, onNavigationChanged, sessionState } = input;
  const target = useMemo(() => conversationTarget(agentId, sessionState), [agentId, sessionState]);
  const targetKey = target === undefined ? undefined : conversationTargetKey(target);
  const [entries, setEntries] = useState<ReadonlyMap<string, ConversationEntry>>(
    () => new Map<string, ConversationEntry>()
  );
  const entriesRef = useRef(entries);
  const previousTargetRef = useRef<
    Readonly<{ key: string; target: ConversationTarget }> | undefined
  >(undefined);
  const historyOperations = useMemo(() => new KeyedOperationOwnership(), []);
  const loadMoreOperations = useMemo(() => new KeyedOperationOwnership(), []);
  const interactionOperations = useMemo(() => new KeyedOperationOwnership(), []);
  const branchOperations = useMemo(() => new KeyedOperationOwnership(), []);

  const replaceEntries = useCallback((next: ReadonlyMap<string, ConversationEntry>) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  const updateEntry = useCallback(
    (
      key: string,
      targetValue: ConversationTarget,
      update: (current: ConversationEntry) => ConversationEntry
    ) => {
      const existing = entriesRef.current.get(key);
      const current = existing ?? createEntry(targetValue);
      const sameDefinition = sameTargetDefinition(current.target, targetValue);
      const normalizedCurrent = sameDefinition
        ? current
        : Object.freeze({ ...current, target: targetValue });
      const nextEntry = update(normalizedCurrent);
      if (existing !== undefined && nextEntry === existing) return;
      const next = new Map(entriesRef.current);
      next.set(key, nextEntry);
      replaceEntries(next);
    },
    [replaceEntries]
  );

  const removeEntry = useCallback(
    (key: string) => {
      if (!entriesRef.current.has(key)) return;
      const next = new Map(entriesRef.current);
      next.delete(key);
      replaceEntries(next);
    },
    [replaceEntries]
  );

  const abortTarget = useCallback(
    (key: string, message: string) => {
      historyOperations.abort(key, message);
      loadMoreOperations.abort(key, message);
      interactionOperations.abort(key, message);
      branchOperations.abort(key, message);
    },
    [branchOperations, historyOperations, interactionOperations, loadMoreOperations]
  );

  const readHistory = useCallback(
    (persistedTarget: PersistedConversationTarget, force: boolean) => {
      const key = conversationTargetKey(persistedTarget);
      const current = entriesRef.current.get(key);
      if (!force && current !== undefined && current.historyState.status !== 'idle') return;
      const initialTurnIds = new Set(
        current === undefined ? [] : historyTurns(current.historyState).map((turn) => turn.turnId)
      );
      const controller = historyOperations.begin(key);
      loadMoreOperations.abort(key, 'Conversation history was reloaded.');
      updateEntry(key, persistedTarget, (entry) =>
        Object.freeze({
          ...entry,
          historyState: Object.freeze({
            status: 'loading',
            turns: historyTurns(entry.historyState),
          }),
        })
      );
      void management
        .readConversation({
          agentId: persistedTarget.agentId,
          branchId: persistedTarget.branchId,
          sessionId: persistedTarget.sessionId,
          signal: controller.signal,
        })
        .then(
          (result) => {
            if (!historyOperations.isCurrent(key, controller)) return;
            if (result.status === 'failed') {
              updateEntry(key, persistedTarget, (entry) =>
                Object.freeze({
                  ...entry,
                  historyState: failHistoryRead(entry.historyState, result.failure.message),
                })
              );
              return;
            }
            updateEntry(key, persistedTarget, (entry) =>
              Object.freeze({
                ...entry,
                historyState: resolveHistoryRead(entry.historyState, result.value, initialTurnIds),
              })
            );
          },
          (error: unknown) => {
            if (!historyOperations.isCurrent(key, controller)) return;
            updateEntry(key, persistedTarget, (entry) =>
              Object.freeze({
                ...entry,
                historyState: failHistoryRead(
                  entry.historyState,
                  errorMessage(error, 'The conversation could not be loaded.')
                ),
              })
            );
          }
        )
        .finally(() => historyOperations.complete(key, controller));
    },
    [historyOperations, loadMoreOperations, management, updateEntry]
  );

  useEffect(() => {
    const previous = previousTargetRef.current;
    if (previous !== undefined && previous.target.kind === 'draft' && previous.key !== targetKey) {
      abortTarget(previous.key, 'The unpersisted conversation draft was left.');
      removeEntry(previous.key);
    }
    previousTargetRef.current =
      target === undefined || targetKey === undefined
        ? undefined
        : Object.freeze({ key: targetKey, target });
    if (target === undefined || targetKey === undefined) return;
    updateEntry(targetKey, target, (entry) => entry);
    if (target.kind === 'persisted') readHistory(target, false);
  }, [abortTarget, readHistory, removeEntry, target, targetKey, updateEntry]);

  useEffect(
    () => () => {
      historyOperations.abortAll('Agent Web unmounted.');
      loadMoreOperations.abortAll('Agent Web unmounted.');
      interactionOperations.abortAll('Agent Web unmounted.');
      branchOperations.abortAll('Agent Web unmounted.');
    },
    [branchOperations, historyOperations, interactionOperations, loadMoreOperations]
  );

  const currentEntry =
    target === undefined || targetKey === undefined
      ? undefined
      : (entries.get(targetKey) ?? createEntry(target));

  const loadMore = async () => {
    if (target === undefined || target.kind !== 'persisted' || targetKey === undefined) return;
    const history = entriesRef.current.get(targetKey)?.historyState;
    if (history?.status !== 'ready' || !history.hasMore || history.nextCursor === undefined) {
      return;
    }
    const key = conversationTargetKey(target);
    const cursor = history.nextCursor;
    const controller = loadMoreOperations.beginIfIdle(key);
    if (controller === undefined) return;
    updateEntry(key, target, (entry) =>
      Object.freeze({
        ...entry,
        historyState: Object.freeze({
          ...historyFromPage(history.turns, history.nextCursor),
          loadingMore: true,
        }),
      })
    );
    try {
      const result = await management.readConversation({
        agentId: target.agentId,
        branchId: target.branchId,
        cursor,
        sessionId: target.sessionId,
        signal: controller.signal,
      });
      if (!loadMoreOperations.isCurrent(key, controller)) return;
      if (result.status === 'failed') {
        updateEntry(key, target, (entry) =>
          Object.freeze({
            ...entry,
            historyState: failHistoryPage(entry.historyState, result.failure.message),
          })
        );
        return;
      }
      updateEntry(key, target, (entry) =>
        Object.freeze({
          ...entry,
          historyState: prependHistoryPage(entry.historyState, result.value),
        })
      );
    } catch (error) {
      if (!loadMoreOperations.isCurrent(key, controller)) return;
      updateEntry(key, target, (entry) =>
        Object.freeze({
          ...entry,
          historyState: failHistoryPage(
            entry.historyState,
            errorMessage(error, 'Older turns could not be loaded.')
          ),
        })
      );
    } finally {
      loadMoreOperations.complete(key, controller);
    }
  };

  const send = async () => {
    if (target === undefined || targetKey === undefined) return;
    const entry = entriesRef.current.get(targetKey);
    if (entry === undefined) return;
    if (entry.composerValue.trim().length === 0 || interactionIsRunning(entry.activeInteraction)) {
      return;
    }
    if (target.kind === 'persisted' && target.navigationRevision === undefined) return;
    if (sessionState.status === 'ready' && sessionState.details.status !== 'active') return;

    // A logical send keeps this identity for its entire stream, independently of mounts or tabs.
    const interactionId = globalThis.crypto.randomUUID();
    const controller = interactionOperations.beginIfIdle(targetKey);
    if (controller === undefined) return;
    const message = entry.composerValue.trim();
    let protocolFailure: ConversationStreamProtocolError | undefined;
    let next = createSubmittingInteraction({
      interactionId,
      message,
      timestamp: new Date().toISOString(),
    });
    updateEntry(targetKey, target, (entry) =>
      Object.freeze({ ...entry, activeInteraction: next, composerValue: '' })
    );

    try {
      await management.streamInteraction(
        {
          agentId: target.agentId,
          interactionId,
          message,
          signal: controller.signal,
          ...(target.kind === 'persisted'
            ? {
                session: {
                  branchId: target.branchId,
                  navigationRevision: requireNavigationRevision(target),
                  sessionId: target.sessionId,
                },
              }
            : {}),
        },
        (event) => {
          if (!interactionOperations.isCurrent(targetKey, controller)) return Promise.resolve();
          try {
            requireCompletedEventTarget(event, target);
            next = reduceInteractionEvent(next, event);
            // Completion remains provisional until the port validates and settles the stream.
            if (next.status !== 'completed') {
              updateEntry(targetKey, target, (entry) =>
                Object.freeze({ ...entry, activeInteraction: next })
              );
            }
            return Promise.resolve();
          } catch (error) {
            protocolFailure =
              error instanceof ConversationStreamProtocolError
                ? error
                : new ConversationStreamProtocolError('Interaction event is malformed.');
            return Promise.reject(protocolFailure);
          }
        }
      );
      if (!interactionOperations.isCurrent(targetKey, controller)) return;
      if (protocolFailure !== undefined) throw protocolFailure;
      if (!isTerminalInteraction(next)) {
        next = failInteractionProtocol(next, 'Interaction stream ended without a terminal event.');
        updateEntry(targetKey, target, (entry) =>
          Object.freeze({ ...entry, activeInteraction: next })
        );
      }
    } catch (error) {
      if (!interactionOperations.isCurrent(targetKey, controller)) return;
      if (protocolFailure !== undefined) {
        next = failInteractionProtocol(next, protocolFailure.message);
      } else if (next.status === 'completed') {
        next = failInteractionProtocol(
          next,
          'Interaction transport failed after its completion event.'
        );
      } else if (!isTerminalInteraction(next)) {
        const messageValue =
          error instanceof ConversationStreamProtocolError
            ? error.message
            : controller.signal.aborted
              ? 'The interaction was cancelled.'
              : errorMessage(error, 'The interaction could not be completed.');
        next = controller.signal.aborted
          ? reduceInteractionEvent(next, { interactionId, type: 'cancelled' })
          : failInteractionProtocol(next, messageValue);
      }
      updateEntry(targetKey, target, (entry) =>
        Object.freeze({ ...entry, activeInteraction: next })
      );
    } finally {
      interactionOperations.complete(targetKey, controller);
    }

    if (next.status !== 'completed') return;
    const completed = next;
    if (target.kind === 'persisted') {
      updateEntry(targetKey, target, (entry) =>
        Object.freeze({
          ...entry,
          activeInteraction: undefined,
          historyState: appendCompletedTurn(entry.historyState, completed.turn),
        })
      );
      onConversationCommitted({
        agentId: target.agentId,
        branchId: target.branchId,
        createdSession: false,
        sessionId: target.sessionId,
      });
      return;
    }

    const persistedTarget: PersistedConversationTarget = Object.freeze({
      agentId: target.agentId,
      branchId: completed.turn.branchId,
      kind: 'persisted',
      sessionId: completed.sessionId,
    });
    const persistedKey = conversationTargetKey(persistedTarget);
    const nextEntries = new Map(entriesRef.current);
    nextEntries.delete(targetKey);
    nextEntries.set(
      persistedKey,
      Object.freeze({
        ...createEntry(persistedTarget),
        historyState: historyFromPage(Object.freeze([completed.turn]), undefined),
      })
    );
    replaceEntries(nextEntries);
    onConversationCommitted({
      agentId: target.agentId,
      branchId: completed.turn.branchId,
      createdSession: true,
      sessionId: completed.sessionId,
    });
  };

  const cancel = () => {
    if (target === undefined || targetKey === undefined || currentEntry === undefined) return;
    const current = currentEntry.activeInteraction;
    if (current === undefined || isTerminalInteraction(current)) return;
    const next = markInteractionCancelling(current);
    updateEntry(targetKey, target, (entry) => Object.freeze({ ...entry, activeInteraction: next }));
    interactionOperations.cancel(targetKey, 'Interaction cancelled by the user.');
  };

  const mutateBranch = async (operation: 'fork' | 'rewind', turnId: string) => {
    if (
      target === undefined ||
      target.kind !== 'persisted' ||
      target.navigationRevision === undefined ||
      targetKey === undefined
    ) {
      return;
    }
    const entry = entriesRef.current.get(targetKey);
    if (
      entry === undefined ||
      entry.branchMutationTurnId !== undefined ||
      interactionIsRunning(entry.activeInteraction)
    ) {
      return;
    }
    const controller = branchOperations.beginIfIdle(targetKey);
    if (controller === undefined) return;
    updateEntry(targetKey, target, (entry) =>
      Object.freeze({
        ...entry,
        branchMutationError: undefined,
        branchMutationTurnId: turnId,
      })
    );
    try {
      const common = {
        agentId: target.agentId,
        expectedRevision: target.navigationRevision,
        sessionId: target.sessionId,
        signal: controller.signal,
        throughTurnId: turnId,
      };
      const result =
        operation === 'fork'
          ? await management.forkSessionBranch({
              ...common,
              sourceBranchId: target.branchId,
            })
          : await management.rewindSessionBranch(common);
      if (!branchOperations.isCurrent(targetKey, controller)) return;
      if (result.status === 'failed') {
        updateEntry(targetKey, target, (entry) =>
          Object.freeze({ ...entry, branchMutationError: result.failure.message })
        );
        return;
      }
      onNavigationChanged({ agentId: target.agentId, sessionId: target.sessionId });
    } catch (error) {
      if (!branchOperations.isCurrent(targetKey, controller)) return;
      updateEntry(targetKey, target, (entry) =>
        Object.freeze({
          ...entry,
          branchMutationError: errorMessage(error, 'Session navigation could not be changed.'),
        })
      );
    } finally {
      if (branchOperations.isCurrent(targetKey, controller)) {
        branchOperations.complete(targetKey, controller);
        updateEntry(targetKey, target, (entry) =>
          Object.freeze({ ...entry, branchMutationTurnId: undefined })
        );
      }
    }
  };

  const refreshHistory = () => {
    if (target?.kind === 'persisted') readHistory(target, true);
  };

  const reconcileNavigation = () => {
    if (target?.kind !== 'persisted' || targetKey === undefined) return;
    updateEntry(targetKey, target, (entry) =>
      Object.freeze({ ...entry, branchMutationError: undefined })
    );
    onNavigationChanged({ agentId: target.agentId, sessionId: target.sessionId });
    readHistory(target, true);
  };

  const workingTargets = [...entries.values()]
    .filter((entry) => interactionIsRunning(entry.activeInteraction))
    .map((entry) => entry.target);

  return {
    activeInteraction: currentEntry?.activeInteraction,
    branchMutationError: currentEntry?.branchMutationError,
    branchMutationTurnId: currentEntry?.branchMutationTurnId,
    cancel,
    discardDraft: () => {
      if (target?.kind !== 'draft' || targetKey === undefined) return;
      abortTarget(targetKey, 'New conversation draft was discarded.');
      updateEntry(targetKey, target, () => createEntry(target));
    },
    composerValue: currentEntry?.composerValue ?? '',
    forkFromTurn: (turnId: string) => mutateBranch('fork', turnId),
    historyState: historyStateForSelection(sessionState, currentEntry?.historyState),
    loadMore,
    reconcileNavigation,
    refreshHistory,
    rewindToTurn: (turnId: string) => mutateBranch('rewind', turnId),
    send,
    setComposerValue: (value: string) => {
      if (target === undefined || targetKey === undefined) return;
      updateEntry(targetKey, target, (entry) => Object.freeze({ ...entry, composerValue: value }));
    },
    workingAgentIds: unique(workingTargets.map((workingTarget) => workingTarget.agentId)),
    workingSessionIds: unique(
      workingTargets.flatMap((workingTarget) =>
        workingTarget.kind === 'persisted' && workingTarget.agentId === agentId
          ? [workingTarget.sessionId]
          : []
      )
    ),
  } as const;
}

export type ConversationManagementController = ReturnType<typeof useConversationManagement>;

function createEntry(target: ConversationTarget): ConversationEntry {
  return Object.freeze({
    activeInteraction: undefined,
    branchMutationError: undefined,
    branchMutationTurnId: undefined,
    composerValue: '',
    historyState:
      target.kind === 'draft'
        ? historyFromPage(Object.freeze([]), undefined)
        : Object.freeze({ status: 'idle' }),
    target,
  });
}

function conversationTarget(
  agentId: string | undefined,
  state: SessionSelectionState
): ConversationTarget | undefined {
  if (agentId === undefined) return undefined;
  if (state.status === 'draft') return Object.freeze({ agentId, kind: 'draft' });
  return state.status === 'ready'
    ? Object.freeze({
        agentId,
        branchId: state.navigation.selectedBranchId,
        kind: 'persisted',
        navigationRevision: state.navigation.revision,
        sessionId: state.details.sessionId,
      })
    : undefined;
}

function conversationTargetKey(target: ConversationTarget): string {
  return JSON.stringify(
    target.kind === 'draft'
      ? ['draft', target.agentId]
      : ['persisted', target.agentId, target.sessionId, target.branchId]
  );
}

function sameTargetDefinition(left: ConversationTarget, right: ConversationTarget): boolean {
  return (
    left.kind === right.kind &&
    left.agentId === right.agentId &&
    (left.kind === 'draft' ||
      (right.kind === 'persisted' &&
        left.branchId === right.branchId &&
        left.sessionId === right.sessionId &&
        left.navigationRevision === right.navigationRevision))
  );
}

function historyStateForSelection(
  sessionState: SessionSelectionState,
  historyState: ConversationHistoryState | undefined
): ConversationHistoryState {
  if (historyState !== undefined) return historyState;
  if (sessionState.status === 'loading') return Object.freeze({ status: 'loading', turns: [] });
  if (sessionState.status === 'failed') {
    return Object.freeze({ error: sessionState.error, status: 'failed', turns: [] });
  }
  return Object.freeze({ status: 'idle' });
}

function interactionIsRunning(state: ActiveInteractionState | undefined): boolean {
  return (
    state?.status === 'cancelling' ||
    state?.status === 'streaming' ||
    state?.status === 'submitting'
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function requireCompletedEventTarget(
  event: ConversationInteractionEvent,
  target: ConversationTarget
): void {
  if (
    event.type === 'completed' &&
    target.kind === 'persisted' &&
    (event.sessionId !== target.sessionId || event.turn.branchId !== target.branchId)
  ) {
    throw new ConversationStreamProtocolError(
      'Completed interaction target does not match the requested Session branch.'
    );
  }
}

function requireNavigationRevision(target: PersistedConversationTarget): SessionRevision {
  if (target.navigationRevision === undefined) {
    throw new ConversationStreamProtocolError('Persisted conversation target is not ready.');
  }
  return target.navigationRevision;
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}
