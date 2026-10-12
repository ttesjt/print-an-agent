import type {
  SessionDetails,
  SessionLifecycleStatus,
  SessionManagementFailure,
  SessionManagementResult,
  SessionNavigationSnapshot,
  SessionSummary,
} from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ConversationAdmissionTarget,
  ConversationCommitTarget,
  SessionManagementPort,
} from '../application/ports.js';
import type { WorkspaceLocation } from '../application/workspace-location.js';

export type SessionSelectionState =
  | Readonly<{ draftId: string; status: 'draft' }>
  | Readonly<{ error: string; status: 'failed' }>
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{
      details: SessionDetails;
      navigation: SessionNavigationSnapshot;
      status: 'ready';
    }>;

type SessionCatalogApplicationState =
  | Readonly<{ error: string; status: 'failed' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{
      hasMore: boolean;
      loadMoreError?: string;
      loadingMore?: boolean;
      nextCursor?: string;
      sessions: readonly SessionSummary[];
      status: 'ready';
    }>;

export function useSessionManagement(
  agentId: string | undefined,
  management: SessionManagementPort,
  requestedLocation?: WorkspaceLocation
) {
  const consumedLocation = useRef<WorkspaceLocation | undefined>(undefined);
  const [lifecycleFilter, setLifecycleFilterState] = useState<SessionLifecycleStatus>('active');
  const [catalogState, setCatalogState] = useState<SessionCatalogApplicationState>({
    status: 'loading',
  });
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<string>();
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [selectionState, setSelectionState] = useState<SessionSelectionState>({ status: 'idle' });
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameError, setRenameError] = useState<string>();
  const [renameFieldError, setRenameFieldError] = useState<string>();
  const [metadataConflict, setMetadataConflict] = useState<string>();
  const [retireOpen, setRetireOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [navigationError, setNavigationError] = useState<string>();
  const [workingSessionId, setWorkingSessionId] = useState<string>();
  const [workingBranchId, setWorkingBranchId] = useState<string>();
  const selectedSessionIdRef = useRef<string | undefined>(undefined);
  const selectedDraftIdRef = useRef<string | undefined>(undefined);
  const agentIdRef = useRef(agentId);
  const lifecycleFilterRef = useRef(lifecycleFilter);
  const catalogControllerRef = useRef<AbortController | undefined>(undefined);
  const loadMoreControllerRef = useRef<AbortController | undefined>(undefined);
  const sessionMutationControllerRef = useRef<AbortController | undefined>(undefined);
  const navigationControllerRef = useRef<AbortController | undefined>(undefined);
  const inspectionControllerRef = useRef<AbortController | undefined>(undefined);

  agentIdRef.current = agentId;
  lifecycleFilterRef.current = lifecycleFilter;

  const refreshCatalog = useCallback(() => setCatalogRevision((value) => value + 1), []);
  const reconcileInteractionCatalog = useCallback(
    (target: Readonly<{ agentId: string }>) => {
      if (target.agentId === agentIdRef.current) refreshCatalog();
    },
    [refreshCatalog]
  );
  const reconcileSelectedSession = useCallback(() => {
    setSelectionRevision((value) => value + 1);
    refreshCatalog();
  }, [refreshCatalog]);
  const selectSession = useCallback((sessionId: string | undefined) => {
    selectedDraftIdRef.current = undefined;
    if (selectedSessionIdRef.current === sessionId) return;
    sessionMutationControllerRef.current?.abort(
      new DOMException('Session selection changed.', 'AbortError')
    );
    navigationControllerRef.current?.abort(
      new DOMException('Session selection changed.', 'AbortError')
    );
    selectedSessionIdRef.current = sessionId;
    setSelectedSessionId(sessionId);
    setWorkingSessionId(undefined);
    setWorkingBranchId(undefined);
    setRenameOpen(false);
    setRetireOpen(false);
    setPurgeOpen(false);
  }, []);
  const selectDraft = useCallback(
    (draftId: string) => {
      selectSession(undefined);
      selectedDraftIdRef.current = draftId;
      setLifecycleFilterState('active');
      setSelectionState({ draftId, status: 'draft' });
    },
    [selectSession]
  );
  const createDraft = useCallback(() => selectDraft(globalThis.crypto.randomUUID()), [selectDraft]);
  const forgetAgent = useCallback((removedId: string) => {
    if (agentIdRef.current !== removedId) return;
    agentIdRef.current = undefined;
    catalogControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();
    inspectionControllerRef.current?.abort();
    sessionMutationControllerRef.current?.abort();
    navigationControllerRef.current?.abort();
    sessionMutationControllerRef.current = undefined;
    navigationControllerRef.current = undefined;
    selectedSessionIdRef.current = undefined;
    selectedDraftIdRef.current = undefined;
    setSelectedSessionId(undefined);
    setSelectionState({ status: 'idle' });
    setCatalogState({ status: 'ready', hasMore: false, sessions: [] });
    setRenameOpen(false);
    setRetireOpen(false);
    setPurgeOpen(false);
    setRenameTitle('');
    setRenameError(undefined);
    setRenameFieldError(undefined);
    setMetadataConflict(undefined);
    setLifecycleError(undefined);
    setNavigationError(undefined);
    setWorkingSessionId(undefined);
    setWorkingBranchId(undefined);
  }, []);
  const reconcileSession = useCallback(
    (target: Readonly<{ agentId: string; sessionId: string }>) => {
      if (target.agentId !== agentIdRef.current) return;
      refreshCatalog();
      if (selectedSessionIdRef.current === target.sessionId) {
        reconcileSelectedSession();
      }
    },
    [reconcileSelectedSession, refreshCatalog]
  );
  const synchronizeConversationCommit = useCallback(
    (target: ConversationCommitTarget) => {
      if (target.agentId !== agentIdRef.current) return;
      if (target.createdSession) {
        if (target.draftId !== undefined && target.draftId === selectedDraftIdRef.current) {
          setLifecycleFilterState('active');
          selectSession(target.sessionId);
        }
      } else if (selectedSessionIdRef.current === target.sessionId) {
        setSelectionRevision((value) => value + 1);
      }
    },
    [selectSession]
  );
  const synchronizeConversationAdmission = useCallback(
    ({ admission, draftId }: ConversationAdmissionTarget) => {
      if (admission.details.agentId !== agentIdRef.current) return;
      // The durable Session now exists. A later background admission must not steal selection.
      if (lifecycleFilterRef.current === 'active') {
        setCatalogState((current) =>
          current.status === 'ready' &&
          current.sessions.every(
            (session) =>
              session.agentId === admission.details.agentId && session.status === 'active'
          )
            ? {
                ...current,
                sessions: [
                  admission.details,
                  ...current.sessions.filter(
                    (session) => session.sessionId !== admission.details.sessionId
                  ),
                ],
              }
            : { status: 'ready', hasMore: false, sessions: [admission.details] }
        );
      }
      refreshCatalog();
      if (draftId === undefined || draftId !== selectedDraftIdRef.current) return;
      setLifecycleFilterState('active');
      selectSession(admission.details.sessionId);
      setSelectionState({
        details: admission.details,
        navigation: admission.navigation,
        status: 'ready',
      });
    },
    [refreshCatalog, selectSession]
  );

  useEffect(() => {
    selectSession(undefined);
    setSelectionState({ status: 'idle' });
  }, [agentId, selectSession]);
  useEffect(() => {
    if (
      agentId === undefined ||
      requestedLocation === undefined ||
      consumedLocation.current === requestedLocation ||
      requestedLocation.agentId !== agentId
    )
      return;
    consumedLocation.current = requestedLocation;
    selectSession(requestedLocation.sessionId);
    if (requestedLocation.view === 'conversation' && requestedLocation.sessionId === undefined)
      createDraft();
  }, [agentId, requestedLocation, selectSession, createDraft]);

  useEffect(() => {
    const controller = replaceController(catalogControllerRef);
    loadMoreControllerRef.current?.abort();
    if (agentId === undefined) {
      setCatalogState({ hasMore: false, sessions: [], status: 'ready' });
      return () => controller.abort();
    }
    // Reconciliation does not hide a Session already published by the admission boundary.
    setCatalogState((current) =>
      current.status === 'ready' &&
      current.sessions.every(
        (session) => session.agentId === agentId && session.status === lifecycleFilter
      )
        ? current
        : { status: 'loading' }
    );
    void management
      .listSessions({ agentId, signal: controller.signal, status: lifecycleFilter })
      .then(
        (result) => {
          if (controller.signal.aborted || catalogControllerRef.current !== controller) return;
          if (result.status === 'failed') {
            setCatalogState({ error: result.failure.message, status: 'failed' });
            return;
          }
          setCatalogState({
            hasMore: result.value.nextCursor !== undefined,
            sessions: result.value.records,
            status: 'ready',
            ...(result.value.nextCursor === undefined
              ? {}
              : { nextCursor: result.value.nextCursor }),
          });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) {
            setCatalogState({
              error: errorMessage(error, 'Sessions could not be loaded.'),
              status: 'failed',
            });
          }
        }
      );
    return () => controller.abort();
  }, [agentId, catalogRevision, lifecycleFilter, management]);

  useEffect(() => {
    if (selectedSessionId === undefined) {
      setSelectionState((current) => (current.status === 'draft' ? current : { status: 'idle' }));
      return;
    }
    if (agentId === undefined) return;
    const controller = new AbortController();
    inspectionControllerRef.current = controller;
    setSelectionState((current) =>
      current.status === 'ready' &&
      current.details.agentId === agentId &&
      current.details.sessionId === selectedSessionId
        ? current
        : { status: 'loading' }
    );
    void Promise.all([
      management.inspectSession({
        agentId,
        sessionId: selectedSessionId,
        signal: controller.signal,
      }),
      management.inspectSessionNavigation({
        agentId,
        sessionId: selectedSessionId,
        signal: controller.signal,
      }),
    ]).then(
      ([detailsResult, navigationResult]) => {
        if (controller.signal.aborted) return;
        if (detailsResult.status === 'failed') {
          setSelectionState({ error: detailsResult.failure.message, status: 'failed' });
          return;
        }
        if (navigationResult.status === 'failed') {
          setSelectionState({ error: navigationResult.failure.message, status: 'failed' });
          return;
        }
        setSelectionState({
          details: detailsResult.value,
          navigation: navigationResult.value,
          status: 'ready',
        });
        setRenameTitle(detailsResult.value.title ?? '');
        setRenameError(undefined);
        setRenameFieldError(undefined);
        setMetadataConflict(undefined);
        setLifecycleError(undefined);
        setNavigationError(undefined);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setSelectionState({
            error: errorMessage(error, 'The Session could not be inspected.'),
            status: 'failed',
          });
        }
      }
    );
    return () => controller.abort();
  }, [agentId, management, selectedSessionId, selectionRevision]);

  useEffect(
    () => () => {
      catalogControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
      sessionMutationControllerRef.current?.abort();
      navigationControllerRef.current?.abort();
    },
    []
  );

  const loadMore = async () => {
    if (agentId === undefined || catalogState.status !== 'ready' || !catalogState.hasMore) return;
    if (catalogState.nextCursor === undefined) return;
    const capturedAgentId = agentId;
    const capturedFilter = lifecycleFilter;
    const controller = replaceController(loadMoreControllerRef);
    setCatalogState({ ...catalogState, loadingMore: true });
    try {
      const result = await management.listSessions({
        agentId: capturedAgentId,
        cursor: catalogState.nextCursor,
        signal: controller.signal,
        status: capturedFilter,
      });
      if (
        controller.signal.aborted ||
        loadMoreControllerRef.current !== controller ||
        agentIdRef.current !== capturedAgentId
      ) {
        return;
      }
      if (result.status === 'failed') {
        setCatalogState({ ...catalogState, loadMoreError: result.failure.message });
        return;
      }
      setCatalogState({
        hasMore: result.value.nextCursor !== undefined,
        sessions: Object.freeze([...catalogState.sessions, ...result.value.records]),
        status: 'ready',
        ...(result.value.nextCursor === undefined ? {} : { nextCursor: result.value.nextCursor }),
      });
    } catch (error) {
      if (!controller.signal.aborted && loadMoreControllerRef.current === controller) {
        setCatalogState({
          ...catalogState,
          loadMoreError: errorMessage(error, 'More Sessions could not be loaded.'),
        });
      }
    }
  };

  const renameSession = async () => {
    const rename = management.renameSession;
    if (rename === undefined) return;
    if (agentId === undefined || selectionState.status !== 'ready') return;
    const selected = selectionState.details;
    setRenameError(undefined);
    setRenameFieldError(undefined);
    await runMutation(
      agentId,
      selected.sessionId,
      async (signal) =>
        rename.call(management, {
          agentId,
          expectedRevision: selected.metadataRevision,
          sessionId: selected.sessionId,
          signal,
          title: renameTitle,
        }),
      (failure) => {
        if (failure.code === 'revision-conflict') {
          setMetadataConflict(failure.message);
          setRenameOpen(false);
          return;
        }
        setRenameError(failure.message);
        if (failure.code === 'validation-failed') {
          setRenameFieldError(
            failure.fieldErrors.find((candidate) => candidate.field === 'title')?.message
          );
        }
      },
      (details) => {
        updateDetails(details);
        setMetadataConflict(undefined);
        setRenameOpen(false);
        refreshCatalog();
      },
      (error) => setRenameError(errorMessage(error, 'The Session could not be renamed.'))
    );
  };

  const changeLifecycle = async (target: SessionLifecycleStatus) => {
    const change = target === 'retired' ? management.retireSession : management.restoreSession;
    if (change === undefined) return;
    if (agentId === undefined || selectionState.status !== 'ready') return;
    const selected = selectionState.details;
    setLifecycleError(undefined);
    await runMutation(
      agentId,
      selected.sessionId,
      (signal) =>
        change.call(management, {
          agentId,
          expectedRevision: selected.metadataRevision,
          sessionId: selected.sessionId,
          signal,
        }),
      (failure) => {
        setLifecycleError(failure.message);
        if (failure.code === 'revision-conflict') {
          setRetireOpen(false);
          setPurgeOpen(false);
        }
      },
      () => {
        setRetireOpen(false);
        selectSession(undefined);
        refreshCatalog();
      },
      (error) =>
        setLifecycleError(errorMessage(error, 'The Session lifecycle could not be changed.'))
    );
  };

  const purgeSession = async () => {
    const purge = management.purgeSession;
    if (purge === undefined) return;
    if (agentId === undefined || selectionState.status !== 'ready') return;
    const selected = selectionState.details;
    setLifecycleError(undefined);
    await runMutation(
      agentId,
      selected.sessionId,
      (signal) =>
        purge.call(management, {
          agentId,
          confirmation: 'permanently-delete-session',
          expectedRevision: selected.metadataRevision,
          sessionId: selected.sessionId,
          signal,
        }),
      (failure) => {
        setLifecycleError(failure.message);
        if (failure.code === 'revision-conflict') setPurgeOpen(false);
      },
      () => {
        setPurgeOpen(false);
        selectSession(undefined);
        refreshCatalog();
      },
      (error) => setLifecycleError(errorMessage(error, 'The Session could not be deleted.'))
    );
  };

  const selectBranch = async (branchId: string) => {
    const select = management.selectSessionBranch;
    if (select === undefined) return;
    if (agentId === undefined || selectionState.status !== 'ready') return;
    if (
      navigationControllerRef.current !== undefined ||
      branchId === selectionState.navigation.selectedBranchId
    ) {
      return;
    }
    const selected = selectionState;
    const controller = new AbortController();
    navigationControllerRef.current = controller;
    setWorkingBranchId(branchId);
    setNavigationError(undefined);
    try {
      const result = await select.call(management, {
        agentId,
        branchId,
        expectedRevision: selected.navigation.revision,
        sessionId: selected.details.sessionId,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        navigationControllerRef.current !== controller ||
        agentIdRef.current !== agentId ||
        selectedSessionIdRef.current !== selected.details.sessionId
      ) {
        return;
      }
      if (result.status === 'failed') {
        setNavigationError(result.failure.message);
        return;
      }
      setSelectionState((current) =>
        current.status === 'ready' &&
        current.details.agentId === agentId &&
        current.details.sessionId === selected.details.sessionId
          ? {
              details: {
                ...current.details,
                navigationRevision: result.value.revision,
                selectedBranchId: result.value.selectedBranchId,
              },
              navigation: result.value,
              status: 'ready',
            }
          : current
      );
      refreshCatalog();
    } catch (error) {
      if (!controller.signal.aborted) {
        setNavigationError(errorMessage(error, 'The branch could not be selected.'));
      }
    } finally {
      if (navigationControllerRef.current === controller) {
        navigationControllerRef.current = undefined;
        setWorkingBranchId(undefined);
      }
    }
  };

  async function runMutation<Value>(
    capturedAgentId: string,
    sessionId: string,
    operation: (signal: AbortSignal) => Promise<SessionManagementResult<Value>>,
    onFailure: (failure: SessionManagementFailure) => void,
    onSuccess: (value: Value) => void,
    onThrown: (error: unknown) => void
  ) {
    const controller = replaceController(sessionMutationControllerRef);
    setWorkingSessionId(sessionId);
    try {
      const result = await operation(controller.signal);
      if (
        controller.signal.aborted ||
        sessionMutationControllerRef.current !== controller ||
        agentIdRef.current !== capturedAgentId ||
        selectedSessionIdRef.current !== sessionId
      ) {
        return;
      }
      if (result.status === 'failed') onFailure(result.failure);
      else onSuccess(result.value);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        agentIdRef.current === capturedAgentId &&
        selectedSessionIdRef.current === sessionId
      ) {
        onThrown(error);
      }
    } finally {
      if (sessionMutationControllerRef.current === controller) {
        sessionMutationControllerRef.current = undefined;
        setWorkingSessionId(undefined);
      }
    }
  }

  function updateDetails(details: SessionDetails) {
    setSelectionState((current) =>
      current.status === 'ready' && current.details.sessionId === details.sessionId
        ? { ...current, details }
        : current
    );
  }

  return {
    forgetAgent,
    capabilities: {
      rename: management.renameSession !== undefined,
      retire: management.retireSession !== undefined,
      restore: management.restoreSession !== undefined,
      purge: management.purgeSession !== undefined,
      selectBranch: management.selectSessionBranch !== undefined,
    },
    catalogState,
    changeLifecycle,
    createDraft,
    lifecycleError,
    lifecycleFilter,
    loadMore,
    navigationError,
    metadataConflict,
    purgeOpen,
    purgeSession,
    reconcileSession,
    reconcileInteractionCatalog,
    refreshCatalog,
    reconcileSelectedSession,
    renameError,
    renameFieldError,
    renameOpen,
    renameSession,
    renameTitle,
    retireOpen,
    selectBranch,
    selectedSessionId,
    selectionState,
    selectSession,
    selectDraft,
    setLifecycleFilter: (status: SessionLifecycleStatus) => {
      setLifecycleFilterState(status);
      selectSession(undefined);
      setSelectionState({ status: 'idle' });
    },
    setPurgeOpen: (open: boolean) => {
      if (!workingSessionId) setPurgeOpen(open);
    },
    setRenameOpen: (open: boolean) => {
      if (workingSessionId) return;
      setRenameOpen(open);
      setRenameError(undefined);
      setRenameFieldError(undefined);
    },
    setRenameTitle: (title: string) => {
      setRenameTitle(title);
      setRenameError(undefined);
      setRenameFieldError(undefined);
    },
    setRetireOpen: (open: boolean) => {
      if (!workingSessionId) setRetireOpen(open);
    },
    synchronizeConversationCommit,
    synchronizeConversationAdmission,
    workingBranchId,
    workingSessionId,
  } as const;
}

export type SessionManagementController = ReturnType<typeof useSessionManagement>;

function replaceController(ref: { current: AbortController | undefined }) {
  ref.current?.abort(new DOMException('Superseded by a newer operation.', 'AbortError'));
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
