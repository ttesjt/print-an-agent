import {
  AgentCatalog,
  AgentCreateDialog,
  AgentLifecycleActions,
  Alert,
  AppShell,
  AppShellHeader,
  AppShellInspector,
  AppShellMain,
  AppShellSidebar,
  Button,
  Cluster,
  DisableAgentDialog,
  Select,
  Stack,
} from '@ta-agent/ui-react';
import { useEffect, useRef } from 'react';
import { useApplicationTheme } from './application/theme-preference.js';
import type { WorkspaceLocation } from './application/workspace-location.js';

import { useAgentManagement } from './agent/use-agent-management.js';
import type { DemoAgentConfig } from './application/demo-agent-config.js';
import type { AgentWebPorts } from './application/ports.js';
import { AgentWorkspace, DemoConfigFields } from './components/agent-workspace.js';
import { useConversationManagement } from './conversation/use-conversation-management.js';
import { SessionSidebar, SessionWorkspace } from './session/session-management-panels.js';
import { useSessionManagement } from './session/use-session-management.js';

export interface AppProps {
  readonly ports: AgentWebPorts<DemoAgentConfig>;
  readonly profileLabel?: string;
  readonly requestedLocation?: WorkspaceLocation;
  readonly onLocationChange?: (location: WorkspaceLocation) => void;
}

const STATUS_LABELS = Object.freeze({ active: 'Active', disabled: 'Disabled' });

export function App({
  ports,
  profileLabel = 'Agent application',
  requestedLocation,
  onLocationChange,
}: AppProps) {
  const { theme, setTheme } = useApplicationTheme();
  const agents = useAgentManagement(ports.agents, requestedLocation);
  const sessions = useSessionManagement(agents.selectedAgentId, ports.sessions, requestedLocation);
  const previousLocationAgent = useRef(agents.selectedAgentId);
  useEffect(() => {
    if (previousLocationAgent.current !== agents.selectedAgentId) {
      previousLocationAgent.current = agents.selectedAgentId;
      return;
    }
    if (
      sessions.selectionState.status === 'ready' &&
      sessions.selectionState.details.agentId !== agents.selectedAgentId
    )
      return;
    onLocationChange?.({
      ...(agents.selectedAgentId === undefined ? {} : { agentId: agents.selectedAgentId }),
      ...(sessions.selectedSessionId === undefined
        ? {}
        : { sessionId: sessions.selectedSessionId }),
    });
  }, [
    agents.selectedAgentId,
    sessions.selectedSessionId,
    sessions.selectionState,
    onLocationChange,
  ]);
  const conversation = useConversationManagement({
    agentId: agents.selectedAgentId,
    management: ports.conversations,
    onConversationCommitted: sessions.synchronizeConversationCommit,
    onNavigationChanged: sessions.reconcileSession,
    sessionState: sessions.selectionState,
  });
  const workingAgentIds = unique([...agents.workingAgentIds, ...conversation.workingAgentIds]);

  return (
    <>
      <AppShell className="ta-ui-root">
        <AppShellHeader>
          <Cluster justify="between" space="medium">
            <strong>Agent Web</strong>
            <Cluster space="small">
              <span>{profileLabel}</span>
              <Select
                aria-label="Theme"
                value={theme}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === 'light' || value === 'dark' || value === 'system') setTheme(value);
                }}
              >
                <option value="system">System theme</option>
                <option value="light">Light theme</option>
                <option value="dark">Dark theme</option>
              </Select>
            </Cluster>
          </Cluster>
        </AppShellHeader>

        <AppShellSidebar aria-labelledby="agent-catalog-title">
          <Stack space="large">
            <Stack space="small">
              <h2 id="agent-catalog-title">Agents</h2>
              <AgentCatalog
                createAction={
                  <Button onClick={() => agents.setCreateOpen(true)}>Create Agent</Button>
                }
                emptyDescription="Create an Agent to begin."
                emptyTitle="No Agents are available."
                loadingLabel="Loading Agents…"
                onRetry={agents.refreshCatalog}
                onSelectAgent={agents.selectAgent}
                retryLabel="Retry"
                selectedAgentId={agents.selectedAgentId}
                state={agents.catalogState}
                statusLabels={STATUS_LABELS}
                workingAgentIds={workingAgentIds}
                workingLabel="Working"
              />
            </Stack>
            <SessionSidebar
              agentSelected={agents.selectedAgentId !== undefined}
              controller={sessions}
              workingConversationSessionIds={conversation.workingSessionIds}
            />
          </Stack>
        </AppShellSidebar>

        <AppShellMain>
          <Stack space="large">
            <AgentWorkspace
              configConflict={agents.configConflict}
              configDirty={agents.configDirty}
              configDraft={agents.configDraft}
              configError={agents.configError}
              configFieldErrors={agents.configFieldErrors}
              onReloadConfig={() => void agents.reloadConfig()}
              onResetConfig={agents.resetConfig}
              onSaveConfig={() => void agents.saveConfig()}
              selectionState={agents.selectionState}
              setConfigDraft={agents.setConfigDraft}
              working={agents.configWorking}
            />
            <SessionWorkspace
              conversation={conversation}
              controller={sessions}
              interactionAllowed={
                agents.selectionState.status === 'ready' &&
                agents.selectionState.snapshot.details.status === 'active'
              }
            />
          </Stack>
        </AppShellMain>

        <AppShellInspector aria-labelledby="agent-lifecycle-title">
          <Stack space="medium">
            <h2 id="agent-lifecycle-title">Lifecycle</h2>
            {agents.selected === undefined ? (
              <p>Select an Agent to inspect its lifecycle.</p>
            ) : (
              <AgentLifecycleActions
                disableLabel="Disable Agent"
                onReactivate={() => void agents.changeLifecycle('active')}
                onRequestDisable={() => agents.setDisableOpen(true)}
                pending={agents.lifecycleWorking}
                reactivateLabel="Reactivate Agent"
                status={agents.selected.details.status}
              />
            )}
            {agents.lifecycleConflict !== undefined && (
              <Alert announcement="assertive" tone="caution">
                <span>{agents.lifecycleConflict}</span>
                <Button
                  appearance="outline"
                  onClick={() => void agents.reloadLifecycle()}
                  pending={agents.lifecycleWorking}
                  size="small"
                  tone="neutral"
                >
                  Reload current lifecycle
                </Button>
              </Alert>
            )}
            {agents.lifecycleError !== undefined && (
              <Alert announcement="assertive" tone="critical">
                {agents.lifecycleError}
              </Alert>
            )}
          </Stack>
        </AppShellInspector>
      </AppShell>

      <AgentCreateDialog
        cancelLabel="Cancel"
        configFields={
          <DemoConfigFields
            config={agents.createConfig}
            fieldErrors={agents.createConfigErrors}
            onChange={agents.setCreateConfig}
            prefix="create"
          />
        }
        description="Create an immutable Agent identity and its initial configuration."
        error={agents.createError}
        fieldErrors={agents.createIdentityErrors}
        identity={agents.createIdentity}
        labels={{ agentId: 'Agent ID', displayName: 'Display name' }}
        onIdentityChange={agents.setCreateIdentity}
        onOpenChange={agents.setCreateOpen}
        onSubmit={() => void agents.createAgent()}
        open={agents.createOpen}
        pending={agents.createPending}
        submitLabel="Create Agent"
        title="Create Agent"
      />

      {agents.selected !== undefined && (
        <DisableAgentDialog
          cancelLabel="Cancel"
          confirmLabel="Disable Agent"
          description={`Disable ${agents.selected.details.displayName}? Existing records remain available.`}
          error={agents.lifecycleConflict ?? agents.lifecycleError}
          onConfirm={() => void agents.changeLifecycle('disabled')}
          onOpenChange={agents.setDisableOpen}
          open={agents.disableOpen}
          pending={agents.lifecycleWorking}
          title="Disable Agent"
        />
      )}
    </>
  );
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}
