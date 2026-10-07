import type { AgentDetails } from '@ta-agent/ui-contracts';
import { useEffect, useRef, useState } from 'react';
import type { AgentWebConfig } from '../application/agent-config.js';
import type { AgentManagementPort } from '../application/ports.js';

export function useAgentMetadata(
  port: AgentManagementPort<AgentWebConfig>,
  details: AgentDetails | undefined,
  onUpdated: (details: AgentDetails) => void
) {
  const [displayName, setName] = useState(details?.displayName ?? '');
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const id = details?.agentId;
  const savedName = details?.displayName;
  const initialized = useRef<
    Readonly<{ id: string | undefined; name: string | undefined }> | undefined
  >(undefined);
  useEffect(() => {
    operation.current?.abort();
    operation.current = undefined;
    initialized.current = { id, name: savedName };
    setName(savedName ?? '');
    setError(undefined);
    setConflict(false);
    setPending(false);
    return () => operation.current?.abort();
  }, [id, savedName, port]);
  useEffect(() => {
    setError(undefined);
    setConflict(false);
  }, [details?.identityRevision]);
  const currentName =
    initialized.current !== undefined &&
    initialized.current.id === id &&
    initialized.current.name === savedName
      ? displayName
      : (savedName ?? '');
  const save = async () => {
    if (details === undefined || operation.current !== undefined) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(undefined);
    setConflict(false);
    try {
      const result = await port.renameAgent({
        agentId: details.agentId,
        displayName: currentName,
        expectedRevision: details.identityRevision,
        signal: controller.signal,
      });
      if (controller.signal.aborted || operation.current !== controller) return;
      if (result.status === 'failed') {
        setError(result.failure.message);
        setConflict(result.failure.code === 'revision-conflict');
      } else onUpdated(result.value);
    } catch {
      if (!controller.signal.aborted) setError('Agent display name could not be saved.');
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        setPending(false);
      }
    }
  };
  return {
    displayName: currentName,
    error,
    conflict,
    pending,
    save,
    dirty: details !== undefined && currentName !== details.displayName,
    setDisplayName: (name: string) => {
      setName(name);
      setError(undefined);
    },
    reset: () => {
      setName(details?.displayName ?? '');
      setError(undefined);
      setConflict(false);
    },
  };
}
export type AgentMetadataController = ReturnType<typeof useAgentMetadata>;
