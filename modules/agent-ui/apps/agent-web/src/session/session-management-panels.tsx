import {
  Alert,
  Button,
  Cluster,
  Panel,
  PanelBody,
  PanelHeader,
  PurgeSessionDialog,
  RenameSessionDialog,
  RetireSessionDialog,
  SessionDetailsView,
  SessionLifecycleActions,
  SessionNavigationView,
  Stack,
  Status,
} from '@ta-agent/ui-react';

import { ConversationWorkspace } from '../conversation/conversation-workspace.js';
import type { ConversationManagementController } from '../conversation/use-conversation-management.js';
import type { SessionManagementController } from './use-session-management.js';
import { ConversationSessionCatalog } from './conversation-session-catalog.js';

const STATUS_LABELS = Object.freeze({ active: 'Active', retired: 'Retired' });

export function SessionSidebar({
  agentSelected,
  controller,
  workingConversationSessionIds,
  submittedDrafts = [],
  sessionListKey = (id: string) => id,
  onSelectDraft,
  onNew,
  onSelectSession,
}: Readonly<{
  agentSelected: boolean;
  controller: SessionManagementController;
  workingConversationSessionIds: readonly string[];
  submittedDrafts?: ConversationManagementController['submittedDrafts'];
  sessionListKey?: (sessionId: string) => string;
  onSelectDraft?: (draftId: string) => void;
  onNew?: () => void;
  onSelectSession?: (sessionId: string) => void;
}>) {
  const workingSessionIds = unique([
    ...workingConversationSessionIds,
    ...(controller.workingSessionId === undefined ? [] : [controller.workingSessionId]),
  ]);
  return (
    <Stack space="small">
      <Cluster justify="between" space="small">
        <h2>Sessions</h2>
        <Button
          disabled={!agentSelected}
          onClick={onNew ?? controller.createDraft}
          size="small"
          tone="accent"
        >
          New
        </Button>
      </Cluster>
      <Cluster space="small">
        <Button
          appearance={controller.lifecycleFilter === 'active' ? 'solid' : 'outline'}
          disabled={!agentSelected}
          onClick={() => controller.setLifecycleFilter('active')}
          size="small"
          tone="neutral"
        >
          Active
        </Button>
        <Button
          appearance={controller.lifecycleFilter === 'retired' ? 'solid' : 'outline'}
          disabled={!agentSelected}
          onClick={() => controller.setLifecycleFilter('retired')}
          size="small"
          tone="neutral"
        >
          Retired
        </Button>
      </Cluster>
      {agentSelected &&
      controller.selectionState.status === 'draft' &&
      !submittedDrafts.some(
        (draft) =>
          controller.selectionState.status === 'draft' &&
          draft.draftId === controller.selectionState.draftId
      ) ? (
        <div className="ta-ui-agent-web-draft-session" data-session-draft-entry aria-current="page">
          New conversation
        </div>
      ) : null}
      <ConversationSessionCatalog
        agentSelected={agentSelected}
        controller={controller}
        onSelectDraft={onSelectDraft}
        onSelectSession={onSelectSession ?? controller.selectSession}
        sessionListKey={sessionListKey}
        submittedDrafts={controller.lifecycleFilter === 'active' ? submittedDrafts : []}
        workingSessionIds={workingSessionIds}
      />
    </Stack>
  );
}

export function SessionWorkspace({
  conversation,
  controller,
  interactionAllowed,
  focusRequest = 0,
}: Readonly<{
  conversation: ConversationManagementController;
  controller: SessionManagementController;
  interactionAllowed: boolean;
  focusRequest?: number;
}>) {
  const state = controller.selectionState;
  if (state.status === 'idle') {
    return <Status>Select a Session or begin a new conversation.</Status>;
  }
  if (state.status === 'draft') {
    return (
      <div className="ta-ui-agent-web-conversation-page" data-session-draft>
        <header className="ta-ui-conversation-heading">
          <h1>
            {conversation.activeInteraction === undefined ? 'New conversation' : 'Untitled Session'}
          </h1>
        </header>
        <ConversationWorkspace
          controller={conversation}
          sessionState={state}
          interactionAllowed={interactionAllowed}
          focusRequest={focusRequest}
        />
      </div>
    );
  }
  if (state.status === 'loading') {
    return <Status announcement="polite">Loading Session…</Status>;
  }
  if (state.status === 'failed') {
    return (
      <Alert announcement="assertive" tone="critical">
        <span>{state.error}</span>
        <Button
          appearance="outline"
          onClick={controller.reconcileSelectedSession}
          size="small"
          tone="neutral"
        >
          Retry loading Session
        </Button>
      </Alert>
    );
  }

  return (
    <div className="ta-ui-agent-web-conversation-page">
      <header className="ta-ui-conversation-heading">
        <h1>{state.details.title ?? 'Untitled Session'}</h1>
      </header>
      <ConversationWorkspace
        controller={conversation}
        sessionState={state}
        interactionAllowed={interactionAllowed}
      />
    </div>
  );
}

export function SessionInspector({
  controller,
}: Readonly<{ controller: SessionManagementController }>) {
  const state = controller.selectionState;
  if (state.status !== 'ready') return <Status>Select a saved Session to see its details.</Status>;
  const title = state.details.title ?? 'Untitled Session';
  const working = controller.workingSessionId === state.details.sessionId;
  return (
    <Stack space="large">
      <SessionDetailsView
        actions={
          <Button
            appearance="outline"
            disabled={working || controller.metadataConflict !== undefined}
            onClick={() => controller.setRenameOpen(true)}
            size="small"
            tone="neutral"
          >
            Rename
          </Button>
        }
        formatTimestamp={formatTimestamp}
        labels={{
          branches: 'Branches',
          createdAt: 'Created',
          sessionId: 'Session ID',
          status: 'Status',
          turns: 'Turns',
          updatedAt: 'Updated',
        }}
        session={state.details}
        statusLabels={STATUS_LABELS}
        title={title}
      />

      <SessionNavigationView
        formatBranchDescription={(branch) =>
          branch.parentBranchId === undefined
            ? 'Root branch'
            : `Forked from ${branch.parentBranchId}`
        }
        getBranchLabel={(branch) => branch.branchId}
        navigation={state.navigation}
        selectedLabel="Selected"
        title="Branches"
        workingLabel="Selecting"
        {...(state.details.status === 'active'
          ? { onSelectBranch: (branchId: string) => void controller.selectBranch(branchId) }
          : {})}
        {...(controller.workingBranchId === undefined
          ? {}
          : { workingBranchId: controller.workingBranchId })}
      />

      {controller.navigationError !== undefined && (
        <Alert announcement="assertive" tone="critical">
          <span>{controller.navigationError}</span>
          <Button
            appearance="outline"
            onClick={controller.reconcileSelectedSession}
            size="small"
            tone="neutral"
          >
            Reload navigation
          </Button>
        </Alert>
      )}
      {controller.metadataConflict !== undefined && (
        <Alert announcement="assertive" tone="caution">
          <span>{controller.metadataConflict}</span>
          <Button
            appearance="outline"
            onClick={controller.reconcileSelectedSession}
            size="small"
            tone="neutral"
          >
            Reload Session metadata
          </Button>
        </Alert>
      )}
      {controller.lifecycleError !== undefined && (
        <Alert announcement="assertive" tone="critical">
          <span>{controller.lifecycleError}</span>
          <Button
            appearance="outline"
            onClick={controller.reconcileSelectedSession}
            size="small"
            tone="neutral"
          >
            Reload Session
          </Button>
        </Alert>
      )}

      <Panel>
        <PanelHeader>
          <h3>Session lifecycle</h3>
        </PanelHeader>
        <PanelBody>
          <SessionLifecycleActions
            pending={working}
            purgeLabel="Permanently delete"
            restoreLabel="Restore Session"
            retireLabel="Retire Session"
            status={state.details.status}
            {...(state.details.status === 'active'
              ? { onRequestRetire: () => controller.setRetireOpen(true) }
              : {
                  onRequestPurge: () => controller.setPurgeOpen(true),
                  onRestore: () => void controller.changeLifecycle('active'),
                })}
          />
        </PanelBody>
      </Panel>

      <RenameSessionDialog
        cancelLabel="Cancel"
        description="Change the display title without changing Session identity."
        error={controller.renameError}
        fieldError={controller.renameFieldError}
        label="Session title"
        onOpenChange={(open) => controller.setRenameOpen(open)}
        onSubmit={() => void controller.renameSession()}
        onTitleChange={controller.setRenameTitle}
        open={controller.renameOpen}
        pending={working}
        submitLabel="Rename Session"
        title="Rename Session"
        value={controller.renameTitle}
      />
      <RetireSessionDialog
        cancelLabel="Cancel"
        confirmLabel="Retire Session"
        description={`Retire ${title}? Its history remains readable.`}
        error={controller.lifecycleError}
        onConfirm={() => void controller.changeLifecycle('retired')}
        onOpenChange={(open) => controller.setRetireOpen(open)}
        open={controller.retireOpen}
        pending={working}
        title="Retire Session"
      />
      <PurgeSessionDialog
        cancelLabel="Cancel"
        confirmLabel="Permanently delete"
        description={`Permanently delete ${title}? This cannot be undone.`}
        error={controller.lifecycleError}
        onConfirm={() => void controller.purgeSession()}
        onOpenChange={(open) => controller.setPurgeOpen(open)}
        open={controller.purgeOpen}
        pending={working}
        title="Delete Session"
      />
    </Stack>
  );
}

function formatTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}
