import {
  AgentCatalog,
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
  Status,
} from '@ta-agent/ui-react';
import type { WorkspacePorts } from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApplicationTheme } from './application/theme-preference.js';
import { useNavigationGuard } from './application/use-navigation-guard.js';
import { useNarrowWorkspace } from './application/use-narrow-workspace.js';
import type { WorkspaceLocation } from './application/workspace-location.js';
import { useWorkspaceController, type WorkspaceController } from './use-workspace-controller.js';
import { AgentMetadataEditor } from './agent/agent-metadata-editor.js';
import { useWorkspaceBoundary } from './use-workspace-boundary.js';
import {
  SessionInspector,
  SessionSidebar,
  SessionWorkspace,
} from './session/session-management-panels.js';
import type { CollectionBoundaryState } from './collection/collection-application.js';
import type {
  WorkspaceExtension,
  WorkspaceExtensionProps,
  WorkspaceSurfaces,
} from './extensions.js';

export interface AgentWorkspaceProps {
  readonly ports: WorkspacePorts;
  readonly extension?: WorkspaceExtension;
  readonly profileLabel?: string;
  readonly requestedLocation?: WorkspaceLocation;
  readonly onLocationChange?: (
    location: WorkspaceLocation,
    options?: Readonly<{ replace?: boolean }>
  ) => void;
  readonly onRequestCollections?: () => void;
  readonly onBoundaryStateChange?: (state: CollectionBoundaryState) => void;
}

export function AgentWorkspace(props: AgentWorkspaceProps) {
  const controller = useWorkspaceController(props);
  const { agents, created, removed } = controller;
  const Extension = props.extension ?? EmptyExtension;
  return (
    <Extension
      agent={agents.selected}
      refresh={agents.refresh}
      onCreated={created}
      onRemoved={removed}
    >
      {(surfaces) => <WorkspaceLayout {...props} controller={controller} surfaces={surfaces} />}
    </Extension>
  );
}
function EmptyExtension({ children }: WorkspaceExtensionProps) {
  return children({});
}

function WorkspaceLayout({
  ports,
  profileLabel = 'Agent application',
  requestedLocation,
  onLocationChange,
  onRequestCollections,
  onBoundaryStateChange,
  controller,
  surfaces,
}: AgentWorkspaceProps & {
  readonly controller: WorkspaceController;
  readonly surfaces: WorkspaceSurfaces;
}) {
  const {
    agents,
    sessions,
    metadata,
    conversation,
    setAppliedLocation,
    view,
    setView,
    selectionReset,
  } = controller;
  const { theme, setTheme } = useApplicationTheme();
  const narrow = useNarrowWorkspace();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const metadataIdentity = useMemo(
    () => (metadata.dirty ? {} : undefined),
    [metadata.dirty, metadata.displayName]
  );
  const boundary = useWorkspaceBoundary([
    surfaces.boundary,
    {
      dirty: metadata.dirty,
      working: metadata.pending,
      editIdentity: metadataIdentity,
      discard: metadata.reset,
    },
  ]);
  const guard = useNavigationGuard(boundary?.dirty ?? false);
  useLayoutEffect(() => {
    setInspectorOpen(false);
    guard.reset();
  }, [selectionReset, guard.reset]);
  const collectionDirty =
    (boundary?.dirty ?? false) || sessions.renameOpen || conversation.hasUnsavedComposerDrafts;
  const collectionWorking =
    (boundary?.working ?? false) ||
    agents.lifecycleWorking ||
    sessions.workingSessionId !== undefined ||
    sessions.workingBranchId !== undefined ||
    conversation.collectionWorking;
  const renameEdits = sessions.renameOpen ? sessions.renameTitle : undefined;
  const editIdentity = useMemo(
    () => (collectionDirty ? {} : undefined),
    [collectionDirty, boundary?.editIdentity, renameEdits, conversation.composerDrafts]
  );
  useEffect(() => {
    onBoundaryStateChange?.({ dirty: collectionDirty, working: collectionWorking, editIdentity });
  }, [collectionDirty, collectionWorking, editIdentity, onBoundaryStateChange]);
  const currentLocation = useRef<WorkspaceLocation>({});
  currentLocation.current = {
    view,
    ...(agents.selectedAgentId === undefined ? {} : { agentId: agents.selectedAgentId }),
    ...(sessions.selectedSessionId === undefined ? {} : { sessionId: sessions.selectedSessionId }),
  };
  const seenLocation = useRef(requestedLocation);
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const pendingNavigation = useRef<
    { source: string | undefined; target: string | undefined } | undefined
  >(undefined);
  const requestNavigation = useCallback(
    (action: () => void, reject?: () => void, target = currentLocation.current.agentId) => {
      const source = currentLocation.current.agentId;
      if (agents.isRemoved(source) || agents.isRemoved(target)) {
        reject?.();
        return;
      }
      if (boundaryRef.current?.navigationBlocked ?? boundaryRef.current?.working) {
        reject?.();
        return;
      }
      pendingNavigation.current = { source, target };
      guard.request(
        () => {
          pendingNavigation.current = undefined;
          if (agents.isRemoved(source) || agents.isRemoved(target)) return;
          boundaryRef.current?.discard();
          action();
        },
        () => {
          pendingNavigation.current = undefined;
          reject?.();
        }
      );
    },
    [agents.isRemoved, guard.request]
  );
  useLayoutEffect(() => {
    const pending = pendingNavigation.current;
    if (
      pending === undefined ||
      (!agents.isRemoved(pending.source) && !agents.isRemoved(pending.target))
    )
      return;
    pendingNavigation.current = undefined;
    guard.reset();
    onLocationChange?.(currentLocation.current, { replace: true });
  }, [agents.removedAgentIds, agents.isRemoved, guard.reset, onLocationChange]);
  useEffect(() => {
    if (requestedLocation === undefined || requestedLocation === seenLocation.current) return;
    seenLocation.current = requestedLocation;
    requestNavigation(
      () => {
        setAppliedLocation(requestedLocation);
        setView(requestedLocation.view ?? 'conversation');
        setInspectorOpen(false);
      },
      () => onLocationChange?.(currentLocation.current, { replace: true }),
      requestedLocation.agentId
    );
  }, [requestedLocation, requestNavigation, onLocationChange, setAppliedLocation, setView]);
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
  const newConversation = () =>
    requestNavigation(() => {
      conversation.discardDraft();
      sessions.createDraft();
      setView('conversation');
      setInspectorOpen(false);
      setFocusRequest((value) => value + 1);
    });
  return (
    <>
      <AppShell className="ta-ui-root ta-ui-workspace-shell" data-view={view}>
        <AppShellHeader>
          <Cluster justify="between" space="medium">
            <Cluster space="small">
              <strong>Agent Web</strong>
              <span>{agents.selected?.displayName ?? 'Choose an Agent'}</span>
            </Cluster>
            <Cluster space="small">
              {surfaces.headerActions}
              {onRequestCollections !== undefined && (
                <Button appearance="text" onClick={onRequestCollections}>
                  Collections
                </Button>
              )}
              <Button
                appearance="text"
                onClick={() => setNavigationOpen((value) => !value)}
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
              <Button
                appearance={view === 'settings' ? 'solid' : 'outline'}
                onClick={() => setView('settings')}
              >
                Agent Profile
              </Button>
              {view === 'conversation' && (
                <Button
                  appearance="outline"
                  onClick={() => setInspectorOpen((value) => !value)}
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
                    surfaces.requestCreate === undefined ? undefined : (
                      <Button onClick={() => requestNavigation(() => surfaces.requestCreate?.())}>
                        Create Agent
                      </Button>
                    )
                  }
                  emptyDescription="Choose another Collection or create an Agent if supported."
                  emptyTitle="No Agents are available."
                  loadingLabel="Loading Agents…"
                  onRetry={agents.refresh}
                  onSelectAgent={(id) => {
                    if (id !== agents.selectedAgentId)
                      requestNavigation(
                        () => {
                          agents.selectAgent(id);
                          setInspectorOpen(false);
                        },
                        undefined,
                        id
                      );
                  }}
                  retryLabel="Retry"
                  selectedAgentId={agents.selectedAgentId}
                  state={agents.catalogState}
                  statusLabels={{ active: 'Active', disabled: 'Disabled' }}
                  workingAgentIds={conversation.workingAgentIds}
                  workingLabel="Working"
                />
                {agents.pageError !== undefined && <Alert>{agents.pageError}</Alert>}
                {agents.catalogState.status === 'ready' &&
                  agents.catalogState.nextCursor !== undefined && (
                    <Button pending={agents.loadingMore} onClick={() => void agents.loadMore()}>
                      Load more Agents
                    </Button>
                  )}
              </Stack>
              <SessionSidebar
                agentSelected={agents.selectedAgentId !== undefined}
                controller={sessions}
                onNew={newConversation}
                submittedDrafts={conversation.submittedDrafts}
                sessionListKey={conversation.sessionListKey}
                onSelectDraft={(id) =>
                  requestNavigation(() => {
                    sessions.selectDraft(id);
                    setView('conversation');
                  })
                }
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
          {agents.error !== undefined && (
            <Alert>
              {agents.error}
              <Button onClick={agents.refresh}>Retry Agent</Button>
            </Alert>
          )}
          {view === 'settings' ? (
            <Stack space="large">
              <h1>Agent Profile</h1>
              {agents.selected !== undefined && ports.agents.renameAgent !== undefined && (
                <AgentMetadataEditor metadata={metadata} refresh={agents.refresh} />
              )}
              {(agents.selected === undefined ? undefined : surfaces.settings) ?? (
                <Status>{agents.selected?.displayName ?? 'Select an Agent.'}</Status>
              )}
              {agents.selected !== undefined && (
                <Cluster>
                  {agents.selected.status === 'active' &&
                    ports.agents.disableAgent !== undefined && (
                      <Button onClick={() => agents.setDisableOpen(true)}>Disable Agent</Button>
                    )}
                  {agents.selected.status === 'disabled' &&
                    ports.agents.reactivateAgent !== undefined && (
                      <Button onClick={() => void agents.changeLifecycle('active')}>
                        Reactivate Agent
                      </Button>
                    )}
                  {agents.lifecycleError !== undefined && (
                    <Alert>
                      {agents.lifecycleError}
                      <Button onClick={agents.refresh}>Reload current lifecycle</Button>
                    </Alert>
                  )}
                </Cluster>
              )}
            </Stack>
          ) : (
            <div className="ta-ui-workspace-main">
              <span className="ta-ui-workspace-profile-label">{profileLabel}</span>
              {agents.selected !== undefined && surfaces.interaction?.notice}
              {agents.selected !== undefined && surfaces.interaction?.allowed === false && (
                <Button appearance="outline" onClick={() => setView('settings')}>
                  Open Agent Settings
                </Button>
              )}
              <SessionWorkspace
                conversation={conversation}
                controller={sessions}
                focusRequest={focusRequest}
                interactionAllowed={
                  agents.selected?.status === 'active' && (surfaces.interaction?.allowed ?? true)
                }
              />
            </div>
          )}
        </AppShellMain>
        {agents.selected !== undefined && view === 'conversation' && inspectorOpen && !narrow && (
          <AppShellInspector aria-label="Session details">
            <SessionInspector controller={sessions} />
            {surfaces.inspector}
          </AppShellInspector>
        )}
      </AppShell>
      {agents.selected !== undefined && view === 'conversation' && narrow && (
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
          {surfaces.inspector}
        </Drawer>
      )}
      {surfaces.createDialog}
      {ports.agents.disableAgent !== undefined && (
        <DisableAgentDialog
          cancelLabel="Cancel"
          confirmLabel="Disable Agent"
          description={`Disable ${agents.selected?.displayName ?? 'Agent'}? Existing records remain available.`}
          error={agents.lifecycleError}
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
        description="Discard unsaved Agent changes?"
        onConfirm={guard.confirm}
        onOpenChange={guard.cancel}
        open={guard.pending}
        pending={boundary?.working ?? false}
        title="Unsaved Agent changes"
        tone="neutral"
      />
    </>
  );
}
