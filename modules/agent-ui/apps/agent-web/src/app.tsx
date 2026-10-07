import {
  AgentCatalog,
  AgentCreateDialog,
  Alert,
  AppShell,
  AppShellHeader,
  AppShellInspector,
  AppShellMain,
  AppShellSidebar,
  Button,
  Cluster,
  ConfirmationDialog,
  DisableAgentDialog,
  Drawer,
  Select,
  Stack,
} from '@ta-agent/ui-react';
import { useEffect, useRef, useState } from 'react';
import { useApplicationTheme } from './application/theme-preference.js';
import { useNavigationGuard } from './application/use-navigation-guard.js';
import { useNarrowWorkspace } from './application/use-narrow-workspace.js';
import type { WorkspaceLocation } from './application/workspace-location.js';
import { useAgentManagement } from './agent/use-agent-management.js';
import { useAgentMetadata } from './agent/use-agent-metadata.js';
import { useModelManagement } from './agent/use-model-management.js';
import type { AgentWebConfig } from './application/agent-config.js';
import type { AgentWebPorts } from './application/ports.js';
import { AgentConfigurationFields } from './components/agent-workspace.js';
import { AgentProfile } from './components/agent-profile.js';
import { useConversationManagement } from './conversation/use-conversation-management.js';
import {
  SessionInspector,
  SessionSidebar,
  SessionWorkspace,
} from './session/session-management-panels.js';
import { useSessionManagement } from './session/use-session-management.js';

export interface AppProps {
  readonly ports: AgentWebPorts<AgentWebConfig>;
  readonly profileLabel?: string;
  readonly requestedLocation?: WorkspaceLocation;
  readonly onLocationChange?: (
    location: WorkspaceLocation,
    options?: Readonly<{ replace?: boolean }>
  ) => void;
  /** Explicit application/qualification defaults, not a backend fallback. */
  readonly creationConfig?: AgentWebConfig;
}
const STATUS_LABELS = Object.freeze({ active: 'Active', disabled: 'Disabled' });

export function App({
  ports,
  profileLabel = 'Agent application',
  requestedLocation,
  onLocationChange,
  creationConfig,
}: AppProps) {
  const { theme, setTheme } = useApplicationTheme();
  const narrow = useNarrowWorkspace();
  const [appliedLocation, setAppliedLocation] = useState(requestedLocation);
  const [view, setView] = useState<'conversation' | 'settings'>(
    requestedLocation?.view ?? 'conversation'
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const agents = useAgentManagement(ports.agents, appliedLocation, creationConfig);
  const metadata = useAgentMetadata(ports.agents, agents.selected?.details, agents.updateMetadata);
  const model = useModelManagement(ports.agents, agents.selectionState);
  const sessions = useSessionManagement(agents.selectedAgentId, ports.sessions, appliedLocation);
  const guard = useNavigationGuard(
    view === 'settings' &&
      ((agents.configDirty && !agents.configWorking) || (metadata.dirty && !metadata.pending))
  );
  const conversation = useConversationManagement({
    agentId: agents.selectedAgentId,
    management: ports.conversations,
    onConversationCommitted: sessions.synchronizeConversationCommit,
    onNavigationChanged: sessions.reconcileSession,
    sessionState:
      view === 'settings' && sessions.selectionState.status === 'draft'
        ? { status: 'idle' }
        : sessions.selectionState,
  });
  const workingAgentIds = [
    ...new Set([...agents.workingAgentIds, ...conversation.workingAgentIds]),
  ];
  const location: WorkspaceLocation = {
    view,
    ...(agents.selectedAgentId === undefined ? {} : { agentId: agents.selectedAgentId }),
    ...(sessions.selectedSessionId === undefined ? {} : { sessionId: sessions.selectedSessionId }),
  };
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const seenLocation = useRef(requestedLocation);
  const resetEdits = useRef(() => {});
  resetEdits.current = () => {
    agents.resetConfig();
    metadata.reset();
  };
  const requestNavigation = (action: () => void) =>
    guard.request(() => {
      agents.resetConfig();
      metadata.reset();
      action();
    });
  useEffect(() => {
    if (requestedLocation === undefined || requestedLocation === seenLocation.current) return;
    seenLocation.current = requestedLocation;
    guard.request(
      () => {
        resetEdits.current();
        setAppliedLocation(requestedLocation);
        setView(requestedLocation.view ?? 'conversation');
        setInspectorOpen(false);
      },
      () => onLocationChange?.(currentLocation.current, { replace: true })
    );
  }, [requestedLocation, guard.request, onLocationChange]);
  const previousAgent = useRef(agents.selectedAgentId);
  useEffect(() => {
    if (previousAgent.current !== agents.selectedAgentId) {
      previousAgent.current = agents.selectedAgentId;
      return;
    }
    if (
      sessions.selectionState.status === 'ready' &&
      sessions.selectionState.details.agentId !== agents.selectedAgentId
    )
      return;
    onLocationChange?.(currentLocation.current);
  }, [
    agents.selectedAgentId,
    sessions.selectedSessionId,
    sessions.selectionState,
    view,
    onLocationChange,
  ]);
  useEffect(() => {
    if (
      view === 'conversation' &&
      agents.selectedAgentId !== undefined &&
      (appliedLocation?.sessionId === undefined ||
        appliedLocation.agentId !== agents.selectedAgentId) &&
      sessions.selectedSessionId === undefined &&
      sessions.selectionState.status === 'idle'
    )
      sessions.createDraft();
  }, [
    view,
    appliedLocation,
    agents.selectedAgentId,
    sessions.selectedSessionId,
    sessions.selectionState.status,
    sessions.createDraft,
  ]);
  const newConversation = () =>
    requestNavigation(() => {
      conversation.discardDraft();
      sessions.createDraft();
      setView('conversation');
      setInspectorOpen(false);
      setFocusRequest((value) => value + 1);
    });
  const showSettings = () => {
    if (view !== 'settings') setView('settings');
  };

  return (
    <>
      <AppShell className="ta-ui-root ta-ui-agent-web-shell" data-view={view}>
        <AppShellHeader>
          <Cluster justify="between" space="medium">
            <Cluster space="small">
              <strong>Agent Web</strong>
              <span>{agents.selected?.details.displayName ?? 'Choose an Agent'}</span>
            </Cluster>
            <Cluster space="small">
              <Button
                appearance="text"
                onClick={() => setNavigationOpen((open) => !open)}
                aria-expanded={navigationOpen}
              >
                {navigationOpen ? 'Hide navigation' : 'Show navigation'}
              </Button>
              <Button
                appearance={view === 'conversation' ? 'solid' : 'outline'}
                onClick={() =>
                  view !== 'conversation' && requestNavigation(() => setView('conversation'))
                }
              >
                Conversation
              </Button>
              <Button appearance={view === 'settings' ? 'solid' : 'outline'} onClick={showSettings}>
                Agent Profile
              </Button>
              {view === 'conversation' && (
                <Button
                  appearance="outline"
                  onClick={() => setInspectorOpen((open) => !open)}
                  aria-expanded={inspectorOpen}
                >
                  Session details
                </Button>
              )}
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
        {navigationOpen && (
          <AppShellSidebar aria-labelledby="agent-catalog-title">
            <Stack space="large">
              <Stack space="small">
                <h2 id="agent-catalog-title">Agents</h2>
                <AgentCatalog
                  createAction={
                    <Button onClick={() => requestNavigation(() => agents.setCreateOpen(true))}>
                      Create Agent
                    </Button>
                  }
                  emptyDescription="Create an Agent to begin."
                  emptyTitle="No Agents are available."
                  loadingLabel="Loading Agents…"
                  onRetry={agents.refreshCatalog}
                  onSelectAgent={(id) => {
                    if (id !== agents.selectedAgentId)
                      requestNavigation(() => {
                        agents.selectAgent(id);
                        setInspectorOpen(false);
                      });
                  }}
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
                onNew={newConversation}
                onSelectSession={(id) =>
                  requestNavigation(() => {
                    sessions.selectSession(id);
                    setView('conversation');
                  })
                }
                workingConversationSessionIds={conversation.workingSessionIds}
              />
            </Stack>
          </AppShellSidebar>
        )}
        <AppShellMain>
          {view === 'settings' ? (
            <AgentProfile agents={agents} metadata={metadata} model={model} />
          ) : (
            <div className="ta-ui-agent-web-main">
              <span className="ta-ui-agent-web-profile-label">{profileLabel}</span>
              {!model.ready && (
                <Alert tone="caution">
                  <span>
                    {model.state.status === 'loading'
                      ? 'Checking model availability…'
                      : model.state.status === 'failed'
                        ? model.state.error
                        : 'Configure an available model to start a response.'}
                  </span>
                  <Button appearance="outline" onClick={showSettings}>
                    Open Agent Settings
                  </Button>
                </Alert>
              )}
              <SessionWorkspace
                conversation={conversation}
                controller={sessions}
                focusRequest={focusRequest}
                interactionAllowed={agents.selected?.details.status === 'active' && model.ready}
              />
            </div>
          )}
        </AppShellMain>
        {view === 'conversation' && inspectorOpen && !narrow && (
          <AppShellInspector aria-label="Session details">
            <SessionInspector controller={sessions} />
          </AppShellInspector>
        )}
      </AppShell>
      {view === 'conversation' && narrow && (
        <Drawer
          open={inspectorOpen}
          onOpenChange={() => setInspectorOpen(false)}
          title="Session details"
          footer={
            <Button appearance="outline" onClick={() => setInspectorOpen(false)}>
              Close Session details
            </Button>
          }
        >
          <SessionInspector controller={sessions} />
        </Drawer>
      )}
      <AgentCreateDialog
        cancelLabel="Cancel"
        configFields={
          <AgentConfigurationFields
            config={agents.createConfig}
            fieldErrors={agents.createConfigErrors}
            onChange={agents.setCreateConfig}
            prefix="create"
          />
        }
        description="Create an immutable Agent identity and configure its own model connection."
        error={agents.createError}
        fieldErrors={agents.createIdentityErrors}
        identity={agents.createIdentity}
        labels={{ agentId: 'Agent ID', displayName: 'Display name' }}
        onIdentityChange={agents.setCreateIdentity}
        onOpenChange={agents.setCreateOpen}
        onSubmit={() =>
          void agents.createAgent().then((id) => {
            if (id !== undefined) setView('settings');
          })
        }
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
      <ConfirmationDialog
        cancelLabel="Keep editing"
        confirmLabel="Discard and continue"
        description="Discard unsaved Agent configuration and display-name edits?"
        onConfirm={guard.confirm}
        onOpenChange={guard.cancel}
        open={guard.pending}
        pending={agents.configWorking || metadata.pending}
        title="Unsaved Agent changes"
        tone="neutral"
      />
    </>
  );
}
