import type { SessionRevision } from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { KeyedOperationOwnership } from '../application/operation-ownership.js';
import type {
  ConversationAdmissionTarget,
  ConversationCommitTarget,
  ConversationManagementPort,
} from '../application/ports.js';
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
  markInteractionCancelling,
} from './interaction-state.js';
import { executeConversationInteraction } from './execute-conversation-interaction.js';
import {
  commitReasoningExpansion,
  readReasoningExpansion,
  updateReasoningExpansion,
  type ReasoningExpansionOwner,
  type ReasoningExpansionState,
} from './reasoning-expansion-state.js';

interface DraftConversationTarget {
  readonly agentId: string;
  readonly draftId: string;
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
  readonly reasoningExpansion: ReasoningExpansionState;
  readonly target: ConversationTarget;
}

export function useConversationManagement(input: {
  readonly agentId: string | undefined;
  readonly management: ConversationManagementPort;
  readonly onConversationCommitted: (target: ConversationCommitTarget) => void;
  readonly onSessionAdmitted?: (target: ConversationAdmissionTarget) => void;
  /** A failed/cancelled first response can still leave an authoritative backend Session. */
  readonly onInteractionSettled: (target: Readonly<{ agentId: string }>) => void;
  readonly onNavigationChanged: (target: Readonly<{ agentId: string; sessionId: string }>) => void;
  readonly sessionState: SessionSelectionState;
}) {
  const {
    agentId,
    management,
    onConversationCommitted,
    onSessionAdmitted,
    onInteractionSettled,
    onNavigationChanged,
    sessionState,
  } = input;
  const target = useMemo(() => conversationTarget(agentId, sessionState), [agentId, sessionState]);
  const targetKey = target === undefined ? undefined : conversationTargetKey(target);
  const [entries, setEntries] = useState<ReadonlyMap<string, ConversationEntry>>(
    () => new Map<string, ConversationEntry>()
  );
  const entriesRef = useRef(entries);
  const composerDrafts = useRef<ReadonlyMap<string, string>>(new Map());
  // Sidebar identity survives draft → Session promotion; it never serves as a durable Session ID.
  const sessionListKeys = useRef(new Map<string, string>());
  const previousTargetRef = useRef<
    Readonly<{ key: string; target: ConversationTarget }> | undefined
  >(undefined);
  const historyOperations = useMemo(() => new KeyedOperationOwnership(), []);
  const loadMoreOperations = useMemo(() => new KeyedOperationOwnership(), []);
  const interactionOperations = useMemo(() => new KeyedOperationOwnership(), []);
  const branchOperations = useMemo(() => new KeyedOperationOwnership(), []);

  const replaceEntries = useCallback((next: ReadonlyMap<string, ConversationEntry>) => {
    const drafts = new Map(
      [...next].flatMap(([key, entry]) =>
        entry.composerValue.length === 0 ? [] : [[key, entry.composerValue] as const]
      )
    );
    if (
      drafts.size !== composerDrafts.current.size ||
      [...drafts].some(([key, value]) => composerDrafts.current.get(key) !== value)
    )
      composerDrafts.current = drafts;
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
                ...(entry.activeInteraction?.status === 'committed' &&
                result.value.turns.some(
                  (turn) =>
                    entry.activeInteraction?.status === 'committed' &&
                    turn.turnId === entry.activeInteraction.receipt.turnId &&
                    turn.status === 'completed'
                )
                  ? {
                      activeInteraction: undefined,
                      reasoningExpansion: commitReasoningExpansion(
                        entry.reasoningExpansion,
                        entry.activeInteraction.interactionId,
                        entry.activeInteraction.receipt.turnId
                      ),
                    }
                  : {}),
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

  const forgetAgent = useCallback(
    (removedId: string) => {
      const next = new Map(entriesRef.current);
      for (const [key, entry] of next) {
        if (entry.target.agentId !== removedId) continue;
        abortTarget(key, 'Agent was removed from this workspace.');
        next.delete(key);
        if (entry.target.kind === 'persisted')
          sessionListKeys.current.delete(sessionListIdentity(removedId, entry.target.sessionId));
      }
      if (previousTargetRef.current?.target.agentId === removedId)
        previousTargetRef.current = undefined;
      if (next.size !== entriesRef.current.size) replaceEntries(next);
    },
    [abortTarget, replaceEntries]
  );

  useEffect(() => {
    const previous = previousTargetRef.current;
    if (previous !== undefined && previous.target.kind === 'draft' && previous.key !== targetKey) {
      // Only an unsent draft is disposable. Submitted work owns its lifecycle until settlement.
      if (entriesRef.current.get(previous.key)?.activeInteraction === undefined) {
        abortTarget(previous.key, 'The unsent conversation draft was left.');
        removeEntry(previous.key);
      }
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
    if (entry.composerValue.trim().length === 0) return;
    if (target.kind === 'persisted' && target.navigationRevision === undefined) return;
    if (sessionState.status === 'ready' && sessionState.details.status !== 'active') return;

    // A logical send keeps this identity for its entire stream, independently of mounts or tabs.
    const interactionId = globalThis.crypto.randomUUID();
    // Transport ownership lasts until settlement, independently of any terminal display event.
    const controller = interactionOperations.beginIfIdle(targetKey);
    if (controller === undefined) return;
    const message = entry.composerValue.trim();
    let ownedTarget = target;
    let ownedKey = targetKey;
    const initial = createSubmittingInteraction({
      interactionId,
      message,
      timestamp: new Date().toISOString(),
    });
    updateEntry(targetKey, target, (entry) =>
      Object.freeze({ ...entry, activeInteraction: initial, composerValue: '' })
    );

    let settled: ActiveInteractionState | undefined;
    try {
      settled = await executeConversationInteraction({
        initial,
        isCurrent: () => interactionOperations.isCurrent(ownedKey, controller),
        management,
        request: {
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
        onAdmission: (admission, state) => {
          if (ownedTarget.kind === 'draft') {
            const draftId = ownedTarget.draftId;
            const persisted: PersistedConversationTarget = Object.freeze({
              agentId: ownedTarget.agentId,
              branchId: admission.navigation.selectedBranchId,
              kind: 'persisted',
              navigationRevision: admission.navigation.revision,
              sessionId: admission.details.sessionId,
            });
            const persistedKey = conversationTargetKey(persisted);
            const source = entriesRef.current.get(ownedKey);
            const destination = entriesRef.current.get(persistedKey);
            if (
              source === undefined ||
              destination?.activeInteraction !== undefined ||
              !interactionOperations.move(ownedKey, controller, persistedKey)
            ) {
              throw new ConversationStreamProtocolError(
                'Admitted Session already owns another conversation.'
              );
            }
            const migrated = new Map(entriesRef.current);
            migrated.delete(ownedKey);
            migrated.set(
              persistedKey,
              Object.freeze({
                ...(destination ?? source),
                activeInteraction: state,
                target: persisted,
                reasoningExpansion: new Map([
                  ...(destination?.reasoningExpansion ?? []),
                  ...source.reasoningExpansion,
                ]),
              })
            );
            ownedTarget = persisted;
            sessionListKeys.current.set(
              sessionListIdentity(persisted.agentId, persisted.sessionId),
              ownedKey
            );
            ownedKey = persistedKey;
            replaceEntries(migrated);
            onSessionAdmitted?.({ admission, draftId });
          }
        },
        onProgress: (state) => {
          updateEntry(ownedKey, ownedTarget, (entry) =>
            Object.freeze({ ...entry, activeInteraction: state })
          );
        },
      });
    } finally {
      const accepted = interactionOperations.isCurrent(ownedKey, controller);
      interactionOperations.complete(ownedKey, controller);
      if (accepted) {
        // Publish release of the single-flight boundary, including failed/cancelled streams.
        updateEntry(ownedKey, ownedTarget, (entry) => ({ ...entry }));
        onInteractionSettled({ agentId: target.agentId });
      } else settled = undefined;
    }

    if (settled?.status === 'committed') {
      const committed = settled;
      updateEntry(ownedKey, ownedTarget, (entry) => ({ ...entry, activeInteraction: committed }));
      onConversationCommitted({
        agentId: ownedTarget.agentId,
        branchId: committed.receipt.branchId,
        sessionId: committed.receipt.sessionId,
        createdSession: false,
      });
      return;
    }
    if (settled?.status !== 'completed') return;
    const completed = settled;
    if (ownedTarget.kind === 'persisted') {
      updateEntry(ownedKey, ownedTarget, (entry) =>
        Object.freeze({
          ...entry,
          activeInteraction: undefined,
          historyState: appendCompletedTurn(entry.historyState, completed.turn),
          reasoningExpansion: commitReasoningExpansion(
            entry.reasoningExpansion,
            interactionId,
            completed.turn.turnId
          ),
        })
      );
      onConversationCommitted({
        agentId: ownedTarget.agentId,
        branchId: ownedTarget.branchId,
        createdSession: false,
        sessionId: ownedTarget.sessionId,
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
    sessionListKeys.current.set(
      sessionListIdentity(persistedTarget.agentId, persistedTarget.sessionId),
      targetKey
    );
    const nextEntries = new Map(entriesRef.current);
    nextEntries.delete(targetKey);
    nextEntries.set(
      persistedKey,
      Object.freeze({
        ...createEntry(persistedTarget),
        historyState: historyFromPage(Object.freeze([completed.turn]), undefined),
        reasoningExpansion: commitReasoningExpansion(
          entriesRef.current.get(targetKey)?.reasoningExpansion ?? new Map(),
          interactionId,
          completed.turn.turnId
        ),
      })
    );
    replaceEntries(nextEntries);
    onConversationCommitted({
      agentId: target.agentId,
      branchId: completed.turn.branchId,
      createdSession: true,
      draftId: ownedTarget.draftId,
      sessionId: completed.sessionId,
    });
  };

  const cancel = () => {
    if (target === undefined || targetKey === undefined || currentEntry === undefined) return;
    const current = currentEntry.activeInteraction;
    if (current === undefined || !interactionOperations.isPending(targetKey)) return;
    const next = markInteractionCancelling(current);
    updateEntry(targetKey, target, (entry) => Object.freeze({ ...entry, activeInteraction: next }));
    interactionOperations.cancel(targetKey, 'Interaction cancelled by the user.');
  };

  const mutateBranch = async (operation: 'fork' | 'rewind', turnId: string) => {
    const fork = management.forkSessionBranch;
    const rewind = management.rewindSessionBranch;
    if (operation === 'fork' ? fork === undefined : rewind === undefined) return;
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
      interactionOperations.isPending(targetKey)
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
          ? await fork?.call(management, {
              ...common,
              sourceBranchId: target.branchId,
            })
          : await rewind?.call(management, common);
      if (result === undefined) return;
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

  const workingTargets = [...entries]
    .filter(([key]) => interactionOperations.isPending(key))
    .map(([, entry]) => entry.target);

  return {
    forgetAgent,
    capabilities: {
      fork: management.forkSessionBranch !== undefined,
      rewind: management.rewindSessionBranch !== undefined,
    },
    composerDrafts: composerDrafts.current,
    hasUnsavedComposerDrafts: composerDrafts.current.size > 0,
    collectionWorking:
      workingTargets.length > 0 ||
      [...entries.values()].some((entry) => entry.branchMutationTurnId !== undefined),
    interactionPending: targetKey !== undefined && interactionOperations.isPending(targetKey),
    activeInteraction: currentEntry?.activeInteraction,
    branchMutationError: currentEntry?.branchMutationError,
    branchMutationTurnId: currentEntry?.branchMutationTurnId,
    cancel,
    discardDraft: () => {
      if (target?.kind !== 'draft' || targetKey === undefined) return;
      if (entriesRef.current.get(targetKey)?.activeInteraction !== undefined) return;
      abortTarget(targetKey, 'New conversation draft was discarded.');
      updateEntry(targetKey, target, () => createEntry(target));
    },
    composerValue: currentEntry?.composerValue ?? '',
    sessionListKey: (sessionId: string) =>
      sessionListKeys.current.get(sessionListIdentity(agentId, sessionId)) ??
      sessionListIdentity(agentId, sessionId),
    submittedDrafts: [...entries.values()].flatMap((entry) =>
      entry.target.kind === 'draft' &&
      entry.target.agentId === agentId &&
      entry.activeInteraction !== undefined
        ? [
            {
              draftId: entry.target.draftId,
              listKey: conversationTargetKey(entry.target),
              status: entry.activeInteraction.status,
            },
          ]
        : []
    ),
    forkFromTurn: (turnId: string) => mutateBranch('fork', turnId),
    historyState: historyStateForSelection(sessionState, currentEntry?.historyState),
    loadMore,
    reconcileNavigation,
    refreshHistory,
    reasoningDisclosure: (owner: ReasoningExpansionOwner, modelTurnIndex: number) => ({
      open: readReasoningExpansion(
        currentEntry?.reasoningExpansion ?? new Map(),
        owner,
        modelTurnIndex
      ),
      onOpenChange: (open: boolean) => {
        if (target === undefined || targetKey === undefined) return;
        updateEntry(targetKey, target, (entry) =>
          Object.freeze({
            ...entry,
            reasoningExpansion: updateReasoningExpansion(
              entry.reasoningExpansion,
              owner,
              modelTurnIndex,
              open
            ),
          })
        );
      },
    }),
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
    reasoningExpansion: new Map(),
    target,
  });
}

function conversationTarget(
  agentId: string | undefined,
  state: SessionSelectionState
): ConversationTarget | undefined {
  if (agentId === undefined) return undefined;
  if (state.status === 'draft')
    return Object.freeze({ agentId, draftId: state.draftId, kind: 'draft' });
  return state.status === 'ready' &&
    state.details.agentId === agentId &&
    state.navigation.agentId === agentId
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
      ? ['draft', target.agentId, target.draftId]
      : ['persisted', target.agentId, target.sessionId, target.branchId]
  );
}

function sessionListIdentity(agentId: string | undefined, sessionId: string): string {
  return JSON.stringify(['session', agentId, sessionId]);
}

function sameTargetDefinition(left: ConversationTarget, right: ConversationTarget): boolean {
  return (
    left.kind === right.kind &&
    left.agentId === right.agentId &&
    ((left.kind === 'draft' && right.kind === 'draft' && left.draftId === right.draftId) ||
      (left.kind === 'persisted' &&
        right.kind === 'persisted' &&
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
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
