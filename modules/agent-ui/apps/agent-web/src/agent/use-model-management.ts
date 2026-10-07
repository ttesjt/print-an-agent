import { useEffect, useRef, useState } from 'react';
import type { AgentWebConfig, AgentModelStatus } from '../application/agent-config.js';
import type { AgentManagementPort } from '../application/ports.js';
import type { AgentSelectionState } from '../components/agent-workspace.js';

type ModelState =
  | Readonly<{ status: 'idle' | 'loading' }>
  | Readonly<{ status: 'failed'; error: string }>
  | Readonly<{ status: 'ready'; agentId: string; value: AgentModelStatus }>;

/** Credential availability is not evidence of a successful network invocation. */
export function useModelManagement(
  port: AgentManagementPort<AgentWebConfig>,
  selection: AgentSelectionState
) {
  const snapshot = selection.status === 'ready' ? selection.snapshot : undefined;
  const agentId = snapshot?.details.agentId;
  const revision = snapshot?.config.revision;
  const [state, setState] = useState<ModelState>({ status: 'idle' });
  const [refresh, setRefresh] = useState(0);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string>();
  const probe = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    probe.current?.abort();
    probe.current = undefined;
    setTesting(false);
    setTestMessage(undefined);
    if (agentId === undefined || revision === undefined) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void port.inspectModel({ agentId, signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState(
          result.status === 'failed'
            ? { status: 'failed', error: result.failure.message }
            : result.value.revision !== revision
              ? { status: 'failed', error: 'Configuration changed. Reload current version.' }
              : { status: 'ready', agentId, value: result.value }
        );
      },
      () => {
        if (!controller.signal.aborted)
          setState({ status: 'failed', error: 'Model availability could not be checked.' });
      }
    );
    return () => {
      controller.abort();
      probe.current?.abort();
    };
  }, [agentId, revision, port, refresh]);
  const testConnection = async () => {
    if (agentId === undefined || revision === undefined || probe.current !== undefined) return;
    const controller = new AbortController();
    probe.current = controller;
    setTesting(true);
    setTestMessage(undefined);
    try {
      const result = await port.testModelConnection({
        agentId,
        expectedRevision: revision,
        signal: controller.signal,
      });
      if (!controller.signal.aborted && probe.current === controller)
        setTestMessage(
          result.status === 'failed'
            ? result.failure.message
            : `Connection verified at ${result.value.checkedAt}. No Session was created.`
        );
    } catch {
      if (!controller.signal.aborted)
        setTestMessage(
          'Connection test failed. Check model configuration and the server environment.'
        );
    } finally {
      if (probe.current === controller) {
        probe.current = undefined;
        setTesting(false);
      }
    }
  };
  return {
    state,
    testing,
    testMessage,
    testConnection,
    refresh: () => setRefresh((value) => value + 1),
    cancelTest: () => {
      probe.current?.abort();
      probe.current = undefined;
      setTesting(false);
      setTestMessage('Connection test cancelled.');
    },
    ready:
      state.status === 'ready' &&
      state.agentId === agentId &&
      state.value.revision === revision &&
      (state.value.status === 'configured' || state.value.status === 'engine'),
  };
}
export type ModelManagementController = ReturnType<typeof useModelManagement>;
