import type { AgentDetails, WorkspaceAgentPort } from '@ta-agent/ui-contracts';
import { useEffect, useRef, useState } from 'react';

export function useAgentMetadata(
  port: WorkspaceAgentPort,
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
    const rename = port.renameAgent;
    if (details === undefined || operation.current !== undefined || rename === undefined) return;
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(undefined);
    setConflict(false);
    try {
      const result = await rename.call(port, {
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
    forgetAgent: (removedId: string) => {
      if (initialized.current?.id !== removedId) return;
      operation.current?.abort();
      operation.current = undefined;
      initialized.current = undefined;
      setName('');
      setError(undefined);
      setConflict(false);
      setPending(false);
    },
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
