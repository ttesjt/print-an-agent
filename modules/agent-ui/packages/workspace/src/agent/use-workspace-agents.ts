import type { AgentDetails, AgentSummary, WorkspaceAgentPort } from '@print-an-agent/ui-contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceLocation } from '../application/workspace-location.js';

type CatalogState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'failed'; error: string }>
  | Readonly<{ status: 'ready'; agents: readonly AgentSummary[]; nextCursor?: string }>;

export function useWorkspaceAgents(port: WorkspaceAgentPort, location?: WorkspaceLocation) {
  const [catalogState, setCatalog] = useState<CatalogState>({ status: 'loading' });
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [selected, setSelected] = useState<AgentDetails>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [removedAgentIds, setRemovedAgentIds] = useState<ReadonlySet<string>>(() => new Set());
  const removed = useRef(removedAgentIds);
  const allowInitialSelection = useRef(true);
  const inspection = useRef<AbortController | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pageError, setPageError] = useState<string>();
  const [lifecycleWorking, setWorking] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [disableOpen, setDisableOpen] = useState(false);
  const pages = useRef<AbortController | undefined>(undefined);
  const morePending = useRef(false);
  const consumedCursors = useRef(new Set<string>());
  const mutation = useRef<AbortController | undefined>(undefined);
  const selectedRef = useRef(selectedAgentId);
  selectedRef.current = selectedAgentId;
  const consumedLocation = useRef<WorkspaceLocation | undefined>(undefined);
  const isRemoved = useCallback(
    (id: string | undefined) => id !== undefined && removed.current.has(id),
    []
  );
  const selectAgent = useCallback(
    (id: string | undefined) => {
      if (isRemoved(id)) return;
      allowInitialSelection.current = false;
      selectedRef.current = id;
      setSelectedAgentId(id);
    },
    [isRemoved]
  );
  const refreshCatalog = useCallback(() => {
    pages.current?.abort();
    setRevision((value) => value + 1);
  }, []);
  const refresh = useCallback(() => {
    refreshCatalog();
    setInspectionRevision((value) => value + 1);
  }, [refreshCatalog]);
  const removeAgent = useCallback(
    (id: string) => {
      if (removed.current.has(id)) return false;
      removed.current = new Set([...removed.current, id]);
      setRemovedAgentIds(removed.current);
      setCatalog((current) =>
        current.status === 'ready'
          ? { ...current, agents: current.agents.filter((agent) => agent.agentId !== id) }
          : current
      );
      const wasSelected = selectedRef.current === id;
      if (wasSelected) {
        inspection.current?.abort();
        mutation.current?.abort();
        mutation.current = undefined;
        selectAgent(undefined);
        setSelected(undefined);
        setError(undefined);
        setWorking(false);
        setDisableOpen(false);
        setLifecycleError(undefined);
      }
      refreshCatalog();
      return wasSelected;
    },
    [refreshCatalog, selectAgent]
  );
  const createdAgent = useCallback(
    (id: string) => {
      if (removed.current.has(id)) {
        const next = new Set(removed.current);
        next.delete(id);
        removed.current = next;
        setRemovedAgentIds(next);
      }
      selectAgent(id);
      refresh();
    },
    [refresh, selectAgent]
  );
  useEffect(() => {
    if (location === undefined || location === consumedLocation.current) return;
    consumedLocation.current = location;
    if (location.agentId !== undefined) selectAgent(location.agentId);
  }, [location, selectAgent]);
  useEffect(() => {
    pages.current?.abort();
    const controller = new AbortController();
    pages.current = controller;
    morePending.current = false;
    consumedCursors.current.clear();
    setLoadingMore(false);
    setPageError(undefined);
    void port.listAgentPage({ signal: controller.signal, limit: 50 }).then(
      (result) => {
        if (controller.signal.aborted || pages.current !== controller) return;
        if (result.status === 'failed') {
          setCatalog({ status: 'failed', error: result.failure.message });
          return;
        }
        setCatalog({
          status: 'ready',
          agents: unique(result.value.records).filter((agent) => !isRemoved(agent.agentId)),
          ...(result.value.nextCursor === undefined ? {} : { nextCursor: result.value.nextCursor }),
        });
        // A deep-linked/selected Agent need not occur in this page.
        if (allowInitialSelection.current && selectedRef.current === undefined) {
          const initial =
            location?.agentId ??
            result.value.records.find((agent) => !isRemoved(agent.agentId))?.agentId;
          if (initial !== undefined) selectAgent(initial);
        }
      },
      () => {
        if (!controller.signal.aborted)
          setCatalog({ status: 'failed', error: 'Agents could not be loaded.' });
      }
    );
    return () => controller.abort();
  }, [port, revision, selectAgent, isRemoved]);
  useEffect(() => {
    mutation.current?.abort();
    mutation.current = undefined;
    setWorking(false);
    setDisableOpen(false);
    setLifecycleError(undefined);
    setSelected((current) => (current?.agentId === selectedAgentId ? current : undefined));
    setError(undefined);
    if (selectedAgentId === undefined) return;
    const controller = new AbortController();
    inspection.current = controller;
    void port.inspectAgentDetails({ agentId: selectedAgentId, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'failed') setError(result.failure.message);
        else setSelected(result.value);
      },
      () => {
        if (!controller.signal.aborted) setError('The Agent could not be inspected.');
      }
    );
    return () => controller.abort();
  }, [port, selectedAgentId, inspectionRevision]);
  useEffect(
    () => () => {
      pages.current?.abort();
      mutation.current?.abort();
      inspection.current?.abort();
    },
    []
  );
  const loadMore = async () => {
    if (
      catalogState.status !== 'ready' ||
      catalogState.nextCursor === undefined ||
      morePending.current
    )
      return;
    morePending.current = true;
    const controller = new AbortController();
    pages.current?.abort();
    pages.current = controller;
    setLoadingMore(true);
    setPageError(undefined);
    try {
      const result = await port.listAgentPage({
        cursor: catalogState.nextCursor,
        limit: 50,
        signal: controller.signal,
      });
      if (controller.signal.aborted || pages.current !== controller) return;
      if (result.status === 'failed') {
        setPageError(result.failure.message);
        return;
      }
      if (
        result.value.nextCursor !== undefined &&
        (result.value.nextCursor === catalogState.nextCursor ||
          consumedCursors.current.has(result.value.nextCursor))
      ) {
        setPageError('The catalog returned a repeated cursor. Reload Agents.');
        return;
      }
      consumedCursors.current.add(catalogState.nextCursor);
      setCatalog({
        status: 'ready',
        agents: unique([...catalogState.agents, ...result.value.records]).filter(
          (agent) => !isRemoved(agent.agentId)
        ),
        ...(result.value.nextCursor === undefined ? {} : { nextCursor: result.value.nextCursor }),
      });
    } catch {
      if (!controller.signal.aborted) setPageError('More Agents could not be loaded.');
    } finally {
      if (pages.current === controller) {
        morePending.current = false;
        setLoadingMore(false);
      }
    }
  };
  const changeLifecycle = async (status: 'active' | 'disabled') => {
    const operation = status === 'active' ? port.reactivateAgent : port.disableAgent;
    if (selected === undefined || operation === undefined || mutation.current !== undefined) return;
    const controller = new AbortController();
    mutation.current = controller;
    setWorking(true);
    setLifecycleError(undefined);
    try {
      const result = await operation.call(port, {
        agentId: selected.agentId,
        expectedRevision: selected.identityRevision,
        signal: controller.signal,
      });
      if (controller.signal.aborted || selectedRef.current !== selected.agentId) return;
      if (result.status === 'failed') setLifecycleError(result.failure.message);
      else {
        setSelected(result.value);
        setDisableOpen(false);
        refresh();
      }
    } catch {
      if (!controller.signal.aborted)
        setLifecycleError('The Agent lifecycle could not be changed.');
    } finally {
      if (mutation.current === controller) {
        mutation.current = undefined;
        setWorking(false);
      }
    }
  };
  return {
    removedAgentIds,
    isRemoved,
    removeAgent,
    createdAgent,
    catalogState,
    selectedAgentId,
    selected: selected?.agentId === selectedAgentId ? selected : undefined,
    selectAgent,
    error,
    refresh,
    loadMore,
    loadingMore,
    pageError,
    changeLifecycle,
    lifecycleWorking,
    lifecycleError,
    disableOpen,
    setDisableOpen,
  };
}
function unique(records: readonly AgentSummary[]): readonly AgentSummary[] {
  return [...new Map(records.map((record) => [record.agentId, record])).values()];
}
