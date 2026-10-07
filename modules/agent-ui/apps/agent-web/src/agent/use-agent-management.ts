import type {
  AgentFieldError,
  AgentIdentityDraft,
  AgentManagementFailure,
  AgentSummary,
} from '@ta-agent/ui-contracts';
import type { AgentIdentityFieldErrors } from '@ta-agent/ui-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DemoAgentConfig } from '../application/demo-agent-config.js';
import type { AgentManagementPort } from '../application/ports.js';
import type { WorkspaceLocation } from '../application/workspace-location.js';
import type { AgentSelectionState } from '../components/agent-workspace.js';

export type AgentCatalogState =
  | Readonly<{ status: 'failed'; error: string }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; agents: readonly AgentSummary[] }>;

export interface DemoConfigFieldErrors {
  readonly instructions?: string;
}

const EMPTY_IDENTITY: AgentIdentityDraft = Object.freeze({ agentId: '', displayName: '' });
const DEFAULT_CONFIG: DemoAgentConfig = Object.freeze({
  instructions: 'Help the user clearly and accurately.',
  responseStyle: 'balanced',
});

export function useAgentManagement(
  management: AgentManagementPort<DemoAgentConfig>,
  requestedLocation?: WorkspaceLocation
) {
  const consumedLocation = useRef<WorkspaceLocation | undefined>(undefined);
  const [catalogState, setCatalogState] = useState<AgentCatalogState>({ status: 'loading' });
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [selectionState, setSelectionState] = useState<AgentSelectionState>({ status: 'idle' });
  const [configPendingAgentId, setConfigPendingAgentId] = useState<string>();
  const [lifecyclePendingAgentId, setLifecyclePendingAgentId] = useState<string>();
  const [configError, setConfigError] = useState<string>();
  const [configFieldErrors, setConfigFieldErrors] = useState<DemoConfigFieldErrors>({});
  const [lifecycleError, setLifecycleError] = useState<string>();
  const [lifecycleConflict, setLifecycleConflict] = useState<string>();
  const [createOpen, setCreateOpenState] = useState(false);
  const [createIdentity, setCreateIdentity] = useState<AgentIdentityDraft>(EMPTY_IDENTITY);
  const [createConfig, setCreateConfig] = useState<DemoAgentConfig>(DEFAULT_CONFIG);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [createIdentityErrors, setCreateIdentityErrors] = useState<AgentIdentityFieldErrors>({});
  const [createConfigErrors, setCreateConfigErrors] = useState<DemoConfigFieldErrors>({});
  const [configDraft, setConfigDraftState] = useState<DemoAgentConfig>(DEFAULT_CONFIG);
  const [configConflict, setConfigConflict] = useState<string>();
  const [disableOpen, setDisableOpen] = useState(false);
  const selectedAgentIdRef = useRef<string | undefined>(undefined);
  const createOperationRef = useRef<AbortController | undefined>(undefined);
  const configOperationRef = useRef<AbortController | undefined>(undefined);
  const lifecycleOperationRef = useRef<AbortController | undefined>(undefined);

  const selectAgent = useCallback((agentId: string | undefined) => {
    selectedAgentIdRef.current = agentId;
    setSelectedAgentId(agentId);
    setDisableOpen(false);
  }, []);
  const refreshCatalog = useCallback(() => setCatalogRevision((value) => value + 1), []);
  useEffect(() => {
    if (
      requestedLocation === undefined ||
      consumedLocation.current === requestedLocation ||
      catalogState.status !== 'ready'
    )
      return;
    consumedLocation.current = requestedLocation;
    selectAgent(requestedLocation.agentId);
  }, [catalogState.status, requestedLocation, selectAgent]);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogState({ status: 'loading' });
    void management.listAgents({ signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'failed') {
          setCatalogState({ status: 'failed', error: result.failure.message });
          return;
        }
        setCatalogState({ status: 'ready', agents: result.value });
        selectAgent(chooseSelection(selectedAgentIdRef.current, result.value));
      },
      () => {
        if (!controller.signal.aborted) {
          setCatalogState({ status: 'failed', error: 'Agents could not be loaded.' });
        }
      }
    );
    return () => controller.abort();
  }, [catalogRevision, management, selectAgent]);

  useEffect(() => {
    if (selectedAgentId === undefined) {
      setSelectionState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setSelectionState({ status: 'loading' });
    void management.inspectAgent({ agentId: selectedAgentId, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'failed') {
          setSelectionState({ status: 'failed', error: result.failure.message });
          return;
        }
        setSelectionState({ status: 'ready', snapshot: result.value });
        setConfigDraftState(result.value.config.value);
        setConfigConflict(undefined);
        setConfigError(undefined);
        setConfigFieldErrors({});
        setLifecycleError(undefined);
        setLifecycleConflict(undefined);
      },
      () => {
        if (!controller.signal.aborted) {
          setSelectionState({ status: 'failed', error: 'The Agent could not be inspected.' });
        }
      }
    );
    return () => controller.abort();
  }, [management, selectedAgentId]);

  useEffect(
    () => () => {
      createOperationRef.current?.abort();
      configOperationRef.current?.abort();
      lifecycleOperationRef.current?.abort();
    },
    []
  );

  const createAgent = async () => {
    const controller = replaceOperation(createOperationRef);
    setCreatePending(true);
    setCreateError(undefined);
    setCreateIdentityErrors({});
    setCreateConfigErrors({});
    try {
      const result = await management.createAgent({
        config: createConfig,
        identity: createIdentity,
        signal: controller.signal,
      });
      if (controller.signal.aborted || createOperationRef.current !== controller) return;
      if (result.status === 'failed') {
        setCreateError(result.failure.message);
        if (result.failure.code === 'validation-failed') {
          const errors = groupFieldErrors(result.failure.fieldErrors);
          setCreateIdentityErrors(errors.identity);
          setCreateConfigErrors(errors.config);
        }
        return;
      }
      setCreateOpenState(false);
      setCreateIdentity(EMPTY_IDENTITY);
      setCreateConfig(DEFAULT_CONFIG);
      selectAgent(result.value.details.agentId);
      refreshCatalog();
    } catch (error) {
      if (!controller.signal.aborted && createOperationRef.current === controller) {
        setCreateError(errorMessage(error, 'The Agent could not be created.'));
      }
    } finally {
      if (createOperationRef.current === controller) {
        createOperationRef.current = undefined;
        setCreatePending(false);
      }
    }
  };

  const saveConfig = async () => {
    if (selectionState.status !== 'ready') return;
    const selected = selectionState.snapshot;
    const agentId = selected.details.agentId;
    const controller = replaceOperation(configOperationRef);
    setConfigPendingAgentId(agentId);
    setConfigError(undefined);
    setConfigFieldErrors({});
    setConfigConflict(undefined);
    try {
      const result = await management.updateAgentConfig({
        agentId,
        config: configDraft,
        expectedRevision: selected.config.revision,
        signal: controller.signal,
      });
      if (controller.signal.aborted || configOperationRef.current !== controller) return;
      if (result.status === 'failed') {
        if (selectedAgentIdRef.current === agentId) {
          handleConfigFailure(
            result.failure,
            setConfigConflict,
            setConfigError,
            setConfigFieldErrors
          );
        }
        return;
      }
      refreshCatalog();
      if (selectedAgentIdRef.current === agentId) {
        setSelectionState((current) =>
          current.status === 'ready' && current.snapshot.details.agentId === agentId
            ? {
                status: 'ready',
                snapshot: { config: result.value, details: current.snapshot.details },
              }
            : current
        );
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        configOperationRef.current === controller &&
        selectedAgentIdRef.current === agentId
      ) {
        setConfigError(errorMessage(error, 'The Agent configuration could not be saved.'));
      }
    } finally {
      if (configOperationRef.current === controller) {
        configOperationRef.current = undefined;
        setConfigPendingAgentId(undefined);
      }
    }
  };

  const changeLifecycle = async (target: 'active' | 'disabled') => {
    if (selectionState.status !== 'ready') return;
    const selected = selectionState.snapshot;
    const agentId = selected.details.agentId;
    const controller = replaceOperation(lifecycleOperationRef);
    setLifecyclePendingAgentId(agentId);
    setLifecycleError(undefined);
    setLifecycleConflict(undefined);
    try {
      const common = {
        agentId,
        expectedRevision: selected.details.identityRevision,
        signal: controller.signal,
      };
      const result =
        target === 'disabled'
          ? await management.disableAgent(common)
          : await management.reactivateAgent(common);
      if (controller.signal.aborted || lifecycleOperationRef.current !== controller) return;
      if (result.status === 'failed') {
        if (selectedAgentIdRef.current === agentId) {
          if (result.failure.code === 'revision-conflict') {
            setLifecycleConflict(result.failure.message);
            setDisableOpen(false);
          } else {
            setLifecycleError(result.failure.message);
          }
        }
        return;
      }
      refreshCatalog();
      if (selectedAgentIdRef.current === agentId) {
        setSelectionState((current) =>
          current.status === 'ready' && current.snapshot.details.agentId === agentId
            ? {
                status: 'ready',
                snapshot: { config: current.snapshot.config, details: result.value },
              }
            : current
        );
        setDisableOpen(false);
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        lifecycleOperationRef.current === controller &&
        selectedAgentIdRef.current === agentId
      ) {
        setLifecycleError(errorMessage(error, 'The Agent lifecycle could not be changed.'));
      }
    } finally {
      if (lifecycleOperationRef.current === controller) {
        lifecycleOperationRef.current = undefined;
        setLifecyclePendingAgentId(undefined);
      }
    }
  };

  const reloadConfig = async () => {
    const agentId = selectedAgentIdRef.current;
    if (agentId === undefined) return;
    const controller = replaceOperation(configOperationRef);
    setConfigPendingAgentId(agentId);
    setConfigError(undefined);
    try {
      const result = await management.readAgentConfig({ agentId, signal: controller.signal });
      if (controller.signal.aborted || configOperationRef.current !== controller) return;
      if (result.status === 'failed') {
        if (selectedAgentIdRef.current === agentId) setConfigError(result.failure.message);
        return;
      }
      if (selectedAgentIdRef.current !== agentId) return;
      setSelectionState((current) =>
        current.status === 'ready' && current.snapshot.details.agentId === agentId
          ? {
              status: 'ready',
              snapshot: { config: result.value, details: current.snapshot.details },
            }
          : current
      );
      setConfigDraftState(result.value.value);
      setConfigConflict(undefined);
      setConfigFieldErrors({});
    } catch (error) {
      if (
        !controller.signal.aborted &&
        configOperationRef.current === controller &&
        selectedAgentIdRef.current === agentId
      ) {
        setConfigError(errorMessage(error, 'The current configuration could not be loaded.'));
      }
    } finally {
      if (configOperationRef.current === controller) {
        configOperationRef.current = undefined;
        setConfigPendingAgentId(undefined);
      }
    }
  };

  const reloadLifecycle = async () => {
    const agentId = selectedAgentIdRef.current;
    if (agentId === undefined) return;
    const controller = replaceOperation(lifecycleOperationRef);
    setLifecyclePendingAgentId(agentId);
    setLifecycleError(undefined);
    try {
      const result = await management.inspectAgent({ agentId, signal: controller.signal });
      if (controller.signal.aborted || lifecycleOperationRef.current !== controller) return;
      if (result.status === 'failed') {
        if (selectedAgentIdRef.current === agentId) setLifecycleError(result.failure.message);
        return;
      }
      if (selectedAgentIdRef.current !== agentId) return;
      setSelectionState((current) =>
        current.status === 'ready' && current.snapshot.details.agentId === agentId
          ? {
              status: 'ready',
              snapshot: { config: current.snapshot.config, details: result.value.details },
            }
          : current
      );
      setLifecycleConflict(undefined);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        lifecycleOperationRef.current === controller &&
        selectedAgentIdRef.current === agentId
      ) {
        setLifecycleError(errorMessage(error, 'The current lifecycle could not be loaded.'));
      }
    } finally {
      if (lifecycleOperationRef.current === controller) {
        lifecycleOperationRef.current = undefined;
        setLifecyclePendingAgentId(undefined);
      }
    }
  };

  const selected = selectionState.status === 'ready' ? selectionState.snapshot : undefined;
  return {
    catalogState,
    changeLifecycle,
    configConflict,
    configDirty: selected !== undefined && !sameConfig(configDraft, selected.config.value),
    configDraft,
    configError,
    configFieldErrors,
    configWorking: configPendingAgentId === selectedAgentId,
    createAgent,
    createConfig,
    createConfigErrors,
    createError,
    createIdentity,
    createIdentityErrors,
    createOpen,
    createPending,
    disableOpen,
    lifecycleConflict,
    lifecycleError,
    lifecycleWorking: lifecyclePendingAgentId === selectedAgentId,
    refreshCatalog,
    reloadConfig,
    reloadLifecycle,
    resetConfig: () => {
      if (selected === undefined) return;
      setConfigDraftState(selected.config.value);
      setConfigError(undefined);
      setConfigFieldErrors({});
    },
    saveConfig,
    selectAgent,
    selected,
    selectedAgentId,
    selectionState,
    setConfigDraft: (config: DemoAgentConfig) => {
      setConfigDraftState(config);
      setConfigFieldErrors({});
      setConfigError(undefined);
    },
    setCreateConfig: (config: DemoAgentConfig) => {
      setCreateConfig(config);
      setCreateConfigErrors({});
      setCreateError(undefined);
    },
    setCreateIdentity: (identity: AgentIdentityDraft) => {
      setCreateIdentityErrors((current) => retainIdentityErrors(current, createIdentity, identity));
      setCreateIdentity(identity);
      setCreateError(undefined);
    },
    setCreateOpen: (open: boolean) => {
      if (createPending) return;
      setCreateOpenState(open);
      setCreateError(undefined);
      setCreateIdentityErrors({});
      setCreateConfigErrors({});
    },
    setDisableOpen: (open: boolean) => {
      if (!lifecyclePendingAgentId) setDisableOpen(open);
    },
    workingAgentIds: unique([configPendingAgentId, lifecyclePendingAgentId]),
  } as const;
}

export type AgentManagementController = ReturnType<typeof useAgentManagement>;

function chooseSelection(current: string | undefined, agents: readonly AgentSummary[]) {
  if (current !== undefined && agents.some((agent) => agent.agentId === current)) return current;
  return agents[0]?.agentId;
}

function sameConfig(left: DemoAgentConfig, right: DemoAgentConfig) {
  return left.instructions === right.instructions && left.responseStyle === right.responseStyle;
}

function handleConfigFailure(
  failure: AgentManagementFailure,
  setConflict: (message: string | undefined) => void,
  setError: (message: string | undefined) => void,
  setFieldErrors: (errors: DemoConfigFieldErrors) => void
) {
  if (failure.code === 'revision-conflict') {
    setConflict(failure.message);
    return;
  }
  if (failure.code === 'validation-failed') {
    setFieldErrors(groupFieldErrors(failure.fieldErrors).config);
  }
  setError(failure.message);
}

function groupFieldErrors(fieldErrors: readonly AgentFieldError[]) {
  let agentId: string | undefined;
  let displayName: string | undefined;
  let instructions: string | undefined;
  for (const error of fieldErrors) {
    if (error.field === 'agentId') agentId = error.message;
    if (error.field === 'displayName') displayName = error.message;
    if (error.field === 'instructions') instructions = error.message;
  }
  return {
    config: Object.freeze({ ...(instructions === undefined ? {} : { instructions }) }),
    identity: Object.freeze({
      ...(agentId === undefined ? {} : { agentId }),
      ...(displayName === undefined ? {} : { displayName }),
    }),
  };
}

function replaceOperation(ref: { current: AbortController | undefined }) {
  ref.current?.abort(new DOMException('Superseded by a newer operation.', 'AbortError'));
  const controller = new AbortController();
  ref.current = controller;
  return controller;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function retainIdentityErrors(
  errors: AgentIdentityFieldErrors,
  previous: AgentIdentityDraft,
  next: AgentIdentityDraft
): AgentIdentityFieldErrors {
  return Object.freeze({
    ...(previous.agentId === next.agentId && errors.agentId !== undefined
      ? { agentId: errors.agentId }
      : {}),
    ...(previous.displayName === next.displayName && errors.displayName !== undefined
      ? { displayName: errors.displayName }
      : {}),
  });
}

function unique(values: readonly (string | undefined)[]): readonly string[] {
  return Object.freeze([
    ...new Set(values.filter((value): value is string => value !== undefined)),
  ]);
}
