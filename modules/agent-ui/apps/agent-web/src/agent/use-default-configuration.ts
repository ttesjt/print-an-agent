import type {
  AgentDetails,
  AgentFieldError,
  AgentIdentityDraft,
  AgentManagementFailure,
} from '@print-an-agent/ui-contracts';
import type { AgentIdentityFieldErrors } from '@print-an-agent/ui-react';
import { useEffect, useRef, useState } from 'react';
import type { AgentConfigFieldErrors, AgentWebConfig } from '../application/agent-config.js';
import { DEFAULT_AGENT_CONFIG } from '../application/agent-config.js';
import { sameAgentConfig } from '../application/agent-config-equality.js';
import type { AgentManagementPort } from '../application/ports.js';
import type { AgentSelectionState } from '../components/agent-workspace.js';
const EMPTY_IDENTITY: AgentIdentityDraft = Object.freeze({ agentId: '', displayName: '' });
export function useDefaultConfiguration(
  management: AgentManagementPort<AgentWebConfig>,
  details: AgentDetails | undefined,
  refreshCatalog: () => void,
  onCreated: (id: string) => void,
  creationConfig = DEFAULT_AGENT_CONFIG
) {
  const selectedAgentId = details?.agentId;
  const selectedAgentIdRef = useRef(selectedAgentId);
  selectedAgentIdRef.current = selectedAgentId;
  const [selectionState, setSelectionState] = useState<AgentSelectionState>({ status: 'idle' });
  const [configDraft, setConfigDraftState] = useState(creationConfig);
  const [configPendingAgentId, setConfigPendingAgentId] = useState<string>();
  const [configError, setConfigError] = useState<string>();
  const [configFieldErrors, setConfigFieldErrors] = useState<AgentConfigFieldErrors>({});
  const [configConflict, setConfigConflict] = useState<string>();
  const [createOpen, setCreateOpenState] = useState(false);
  const [createConfig, setCreateConfig] = useState(creationConfig);
  const [createIdentity, setCreateIdentity] = useState(EMPTY_IDENTITY);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const [createConfigErrors, setCreateConfigErrors] = useState<AgentConfigFieldErrors>({});
  const [createIdentityErrors, setCreateIdentityErrors] = useState<AgentIdentityFieldErrors>({});
  const createOperationRef = useRef<AbortController | undefined>(undefined);
  const configOperationRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (details === undefined) return;
    setSelectionState((current) =>
      current.status === 'ready' && current.snapshot.details.agentId === details.agentId
        ? { ...current, snapshot: { ...current.snapshot, details } }
        : current
    );
  }, [details]);
  useEffect(() => {
    if (details === undefined) {
      setSelectionState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setSelectionState({ status: 'loading' });
    void management.readAgentConfig({ agentId: details.agentId, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (result.status === 'failed') {
          setSelectionState({ status: 'failed', error: result.failure.message });
          return;
        }
        setSelectionState({ status: 'ready', snapshot: { details, config: result.value } });
        setConfigDraftState(result.value.value);
        setConfigConflict(undefined);
        setConfigError(undefined);
        setConfigFieldErrors({});
      },
      () => {
        if (!controller.signal.aborted)
          setSelectionState({ status: 'failed', error: 'The Agent could not be inspected.' });
      }
    );
    return () => controller.abort();
  }, [management, selectedAgentId]);
  useEffect(
    () => () => {
      createOperationRef.current?.abort();
      configOperationRef.current?.abort();
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
      setCreateConfig(creationConfig);
      onCreated(result.value.details.agentId);
      refreshCatalog();
      return result.value.details.agentId;
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
    const submittedConfig = configDraft;
    const controller = replaceOperation(configOperationRef);
    setConfigPendingAgentId(agentId);
    setConfigError(undefined);
    setConfigFieldErrors({});
    setConfigConflict(undefined);
    try {
      const result = await management.updateAgentConfig({
        agentId,
        config: submittedConfig,
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
        setConfigDraftState((current) =>
          current === submittedConfig ? result.value.value : current
        );
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

  const selected = selectionState.status === 'ready' ? selectionState.snapshot : undefined;
  return {
    selectionState,
    selected,
    createOpen,
    createPending,
    createError,
    createIdentity,
    createIdentityErrors,
    createConfig,
    createConfigErrors,
    createAgent,
    configDraft,
    configError,
    configFieldErrors,
    configConflict,
    configDirty: selected !== undefined && !sameAgentConfig(configDraft, selected.config.value),
    configWorking: configPendingAgentId !== undefined && configPendingAgentId === selectedAgentId,
    saveConfig,
    reloadConfig,
    resetConfig: () => {
      if (selected !== undefined) setConfigDraftState(selected.config.value);
      setConfigError(undefined);
      setConfigFieldErrors({});
    },
    setConfigDraft: (value: AgentWebConfig) => {
      setConfigDraftState(value);
      setConfigError(undefined);
      setConfigFieldErrors({});
    },
    setCreateConfig: (value: AgentWebConfig) => {
      setCreateConfig(value);
      setCreateConfigErrors({});
      setCreateError(undefined);
    },
    setCreateIdentity: (value: AgentIdentityDraft) => {
      setCreateIdentityErrors((current) => retainIdentityErrors(current, createIdentity, value));
      setCreateIdentity(value);
      setCreateError(undefined);
    },
    setCreateOpen: (open: boolean) => {
      if (createPending) return;
      setCreateOpenState(open);
      setCreateError(undefined);
      setCreateIdentityErrors({});
      setCreateConfigErrors({});
    },
  };
}
export type DefaultConfigurationController = ReturnType<typeof useDefaultConfiguration>;
function handleConfigFailure(
  failure: AgentManagementFailure,
  setConflict: (message: string | undefined) => void,
  setError: (message: string | undefined) => void,
  setFieldErrors: (errors: AgentConfigFieldErrors) => void
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
  const config: Record<string, string> = {};
  for (const error of fieldErrors) {
    if (error.field === 'agentId') agentId = error.message;
    if (error.field === 'displayName') displayName = error.message;
    if (error.field !== 'agentId' && error.field !== 'displayName')
      config[error.field] = error.message;
  }
  return {
    config: Object.freeze(config),
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
