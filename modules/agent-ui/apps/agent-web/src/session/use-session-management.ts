import type {
  SessionDetails,
  SessionLifecycleStatus,
  SessionManagementFailure,
  SessionManagementResult,
  SessionNavigationSnapshot,
  SessionSummary,
} from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ConversationCommitTarget, SessionManagementPort } from '../application/ports.js';
import type { WorkspaceLocation } from '../application/workspace-location.js';

export type SessionSelectionState =
  | Readonly<{ status: 'draft' }>
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
  const agentIdRef = useRef(agentId);
  const catalogControllerRef = useRef<AbortController | undefined>(undefined);
  const loadMoreControllerRef = useRef<AbortController | undefined>(undefined);
  const sessionMutationControllerRef = useRef<AbortController | undefined>(undefined);
  const navigationControllerRef = useRef<AbortController | undefined>(undefined);

  agentIdRef.current = agentId;

  const refreshCatalog = useCallback(() => setCatalogRevision((value) => value + 1), []);
  const reconcileSelectedSession = useCallback(() => {
    setSelectionRevision((value) => value + 1);
    refreshCatalog();
  }, [refreshCatalog]);
  const selectSession = useCallback((sessionId: string | undefined) => {
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
  const reconcileSession = useCallback(
    (target: Readonly<{ agentId: string; sessionId: string }>) => {
      if (target.agentId !== agentId) return;
      refreshCatalog();
      if (selectedSessionIdRef.current === target.sessionId) {
        reconcileSelectedSession();
      }
    },
    [agentId, reconcileSelectedSession, refreshCatalog]
  );
  const synchronizeConversationCommit = useCallback(
    (target: ConversationCommitTarget) => {
      if (target.agentId !== agentId) return;
      refreshCatalog();
      if (target.createdSession) {
        selectSession(target.sessionId);
      } else if (selectedSessionIdRef.current === target.sessionId) {
        setSelectionRevision((value) => value + 1);
      }
    },
    [agentId, refreshCatalog, selectSession]
  );

  useEffect(() => {
    selectSession(undefined);
    setSelectionState({ status: 'idle' });
  }, [agentId, selectSession]);
  useEffect(() => {
    if (
      requestedLocation === undefined ||
      consumedLocation.current === requestedLocation ||
      requestedLocation.agentId !== agentId
    )
      return;
    consumedLocation.current = requestedLocation;
    selectSession(requestedLocation.sessionId);
    if (requestedLocation.view === 'conversation' && requestedLocation.sessionId === undefined)
      setSelectionState({ status: 'draft' });
  }, [agentId, requestedLocation, selectSession]);

  useEffect(() => {
    const controller = replaceController(catalogControllerRef);
    loadMoreControllerRef.current?.abort();
    if (agentId === undefined) {
      setCatalogState({ hasMore: false, sessions: [], status: 'ready' });
      return () => controller.abort();
    }
    setCatalogState({ status: 'loading' });
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
    setSelectionState({ status: 'loading' });
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
    if (agentId === undefined || selectionState.status !== 'ready') return;
    const selected = selectionState.details;
    setRenameError(undefined);
    setRenameFieldError(undefined);
    await runMutation(
      agentId,
      selected.sessionId,
      async (signal) =>
        management.renameSession({
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
    if (agentId === undefined || selectionState.status !== 'ready') return;
    const selected = selectionState.details;
    setLifecycleError(undefined);
    await runMutation(
      agentId,
      selected.sessionId,
      (signal) =>
        target === 'retired'
          ? management.retireSession({
              agentId,
              expectedRevision: selected.metadataRevision,
              sessionId: selected.sessionId,
              signal,
            })
          : management.restoreSession({
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
    if (agentId === undefined || selectionState.status !== 'ready') return;
    const selected = selectionState.details;
    setLifecycleError(undefined);
    await runMutation(
      agentId,
      selected.sessionId,
      (signal) =>
        management.purgeSession({
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
      const result = await management.selectSessionBranch({
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
    catalogState,
    changeLifecycle,
    createDraft: () => {
      selectSession(undefined);
      setSelectionState({ status: 'draft' });
    },
    lifecycleError,
    lifecycleFilter,
    loadMore,
    navigationError,
    metadataConflict,
    purgeOpen,
    purgeSession,
    reconcileSession,
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
