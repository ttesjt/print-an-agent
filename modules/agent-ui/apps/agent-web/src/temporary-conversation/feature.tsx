import type { AgentDetails } from '@ta-agent/ui-contracts';
import { Alert, Button, ConfirmationDialog } from '@ta-agent/ui-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AgentManagementPort } from '../application/ports.js';
import type { AgentWebConfig } from '../application/agent-config.js';
import type { TemporaryConversationPort } from './contracts.js';
import { TemporaryConversationController, type TemporaryTarget } from './controller.js';
import { TemporaryConversationPanel } from './panel.js';

export function TemporaryConversationFeature({
  port,
  agents,
  agent,
  allowed,
}: {
  readonly port: TemporaryConversationPort;
  readonly agents: Pick<AgentManagementPort<AgentWebConfig>, 'readAgentConfig'>;
  readonly agent: AgentDetails | undefined;
  readonly allowed: boolean;
}) {
  const controller = useMemo(() => new TemporaryConversationController(port), [port]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const reader = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      reader.current?.abort();
      reader.current = undefined;
      void controller.dispose();
    },
    [controller]
  );
  useEffect(() => {
    controller.close();
    reader.current?.abort();
    reader.current = undefined;
    setLoading(false);
  }, [agent?.agentId, controller]);
  const open = async (selected: Pick<TemporaryTarget, 'agentId' | 'displayName'>) => {
    reader.current?.abort();
    const operation = new AbortController();
    reader.current = operation;
    setLoading(true);
    setError(undefined);
    try {
      const config = await agents.readAgentConfig({
        agentId: selected.agentId,
        signal: operation.signal,
      });
      if (reader.current !== operation || operation.signal.aborted) return;
      if (config.status === 'failed') {
        setError('Unable to read published Agent settings.');
        return;
      }
      controller.open({ ...selected, configRevision: config.value.revision });
    } catch {
      if (reader.current === operation && !operation.signal.aborted)
        setError('Unable to read published Agent settings.');
    } finally {
      if (reader.current === operation) {
        reader.current = undefined;
        setLoading(false);
      }
    }
  };
  return (
    <>
      <Button
        appearance="outline"
        disabled={agent === undefined || loading}
        onClick={() => {
          if (agent !== undefined) void open(agent);
        }}
      >
        Temporary conversation
      </Button>
      {!state.open && error !== undefined && <Alert tone="critical">{error}</Alert>}
      <TemporaryConversationPanel
        controller={controller}
        state={state}
        loading={loading}
        error={error}
        allowed={allowed && agent?.status === 'active'}
        onClear={() => {
          const target = state.target;
          controller.clear();
          if (target !== undefined) void open(target);
        }}
      />
      <ConfirmationDialog
        open={state.pendingTarget !== undefined}
        onOpenChange={() => controller.dismissReset()}
        title="Replace temporary conversation?"
        description="The Agent or its published settings changed. Discard this temporary history and start again?"
        confirmLabel="Reset and continue"
        cancelLabel="Keep temporary history"
        onConfirm={() => controller.confirmReset()}
      />
    </>
  );
}
