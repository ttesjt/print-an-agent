import {
  Button,
  Grid,
  Panel,
  PanelBody,
  PanelHeader,
  RenameSessionDialog,
  SessionCatalog,
  SessionDetailsView,
  SessionLifecycleActions,
  SessionNavigationView,
  Stack,
} from '@print-an-agent/ui-react';
import { useState } from 'react';

import { GallerySection } from './gallery-section.js';

const ACTIVE_SESSION = Object.freeze({
  agentId: 'research-assistant',
  branchCount: 2,
  createdAt: '2026-02-01T08:00:00.000Z',
  metadataRevision: 'revision-3',
  navigationRevision: 'revision-2',
  selectedBranchId: 'main',
  sessionId: 'evidence-review',
  status: 'active' as const,
  title: 'Evidence review',
  turnCount: 8,
  updatedAt: '2026-02-01T10:30:00.000Z',
});

const RETIRED_SESSION = Object.freeze({
  ...ACTIVE_SESSION,
  metadataRevision: 'revision-5',
  retiredAt: '2026-02-02T12:00:00.000Z',
  sessionId: 'archived-exploration',
  status: 'retired' as const,
  title: 'Archived exploration',
  updatedAt: '2026-02-02T12:00:00.000Z',
});

const NAVIGATION = Object.freeze({
  agentId: ACTIVE_SESSION.agentId,
  branches: Object.freeze([
    Object.freeze({
      branchId: 'main',
      createdAt: '2026-02-01T08:00:00.000Z',
      headTurnId: 'turn-6',
    }),
    Object.freeze({
      branchId: 'alternative',
      createdAt: '2026-02-01T09:30:00.000Z',
      forkedFromTurnId: 'turn-4',
      headTurnId: 'turn-8',
      parentBranchId: 'main',
    }),
  ]),
  revision: ACTIVE_SESSION.navigationRevision,
  selectedBranchId: ACTIVE_SESSION.selectedBranchId,
  sessionId: ACTIVE_SESSION.sessionId,
});

const STATUS_LABELS = Object.freeze({ active: 'Active', retired: 'Retired' });

export function SessionManagementGallery() {
  const [selectedSessionId, setSelectedSessionId] = useState<string>(ACTIVE_SESSION.sessionId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [title, setTitle] = useState<string>(ACTIVE_SESSION.title);

  return (
    <GallerySection
      description="Paginated Session presentation, explicit lifecycle capabilities, and branch selection without backend ownership."
      id="session-management"
      title="Session management"
    >
      <Stack space="large">
        <Grid columns="two">
          <Panel>
            <PanelHeader>
              <h3>Session catalog</h3>
            </PanelHeader>
            <PanelBody>
              <SessionCatalog
                emptyTitle="No Sessions"
                formatMetadata={(session) => `${String(session.turnCount)} turns`}
                loadMoreLabel="Load more"
                loadingLabel="Loading Sessions"
                onLoadMore={() => undefined}
                onSelectSession={setSelectedSessionId}
                selectedSessionId={selectedSessionId}
                state={{
                  hasMore: true,
                  sessions: [ACTIVE_SESSION, RETIRED_SESSION],
                  status: 'ready',
                }}
                statusLabels={STATUS_LABELS}
                untitledLabel="Untitled Session"
                workingLabel="Working"
              />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <h3>Catalog boundary states</h3>
            </PanelHeader>
            <PanelBody>
              <Stack space="medium">
                <SessionCatalog
                  emptyTitle="No Sessions"
                  formatMetadata={() => null}
                  loadMoreLabel="Load more"
                  loadingLabel="Loading Sessions"
                  onSelectSession={() => undefined}
                  state={{ status: 'loading' }}
                  statusLabels={STATUS_LABELS}
                  untitledLabel="Untitled Session"
                  workingLabel="Working"
                />
                <SessionCatalog
                  emptyDescription="Start a conversation to create one."
                  emptyTitle="No Sessions"
                  formatMetadata={() => null}
                  loadMoreLabel="Load more"
                  loadingLabel="Loading Sessions"
                  onSelectSession={() => undefined}
                  state={{ hasMore: false, sessions: [], status: 'ready' }}
                  statusLabels={STATUS_LABELS}
                  untitledLabel="Untitled Session"
                  workingLabel="Working"
                />
              </Stack>
            </PanelBody>
          </Panel>
        </Grid>

        <SessionDetailsView
          actions={<Button onClick={() => setRenameOpen(true)}>Rename</Button>}
          formatTimestamp={(timestamp) => new Date(timestamp).toLocaleString('en-US')}
          labels={{
            branches: 'Branches',
            createdAt: 'Created',
            sessionId: 'Session ID',
            status: 'Status',
            turns: 'Turns',
            updatedAt: 'Updated',
          }}
          session={{ ...ACTIVE_SESSION, title }}
          statusLabels={STATUS_LABELS}
          title={title}
        />

        <Grid columns="two">
          <Panel>
            <PanelHeader>
              <h3>Branch selection</h3>
            </PanelHeader>
            <PanelBody>
              <SessionNavigationView
                formatBranchDescription={(branch) =>
                  branch.parentBranchId === undefined
                    ? 'Root branch'
                    : `Forked from ${branch.parentBranchId}`
                }
                getBranchLabel={(branch) => branch.branchId}
                navigation={NAVIGATION}
                onSelectBranch={() => undefined}
                selectedLabel="Selected"
                title="Branches"
                workingLabel="Selecting"
              />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <h3>Lifecycle capability sets</h3>
            </PanelHeader>
            <PanelBody>
              <Stack space="medium">
                <SessionLifecycleActions
                  onRequestRetire={() => undefined}
                  purgeLabel="Permanently delete"
                  restoreLabel="Restore Session"
                  retireLabel="Retire Session"
                  status="active"
                />
                <SessionLifecycleActions
                  onRequestPurge={() => undefined}
                  onRestore={() => undefined}
                  purgeLabel="Permanently delete"
                  restoreLabel="Restore Session"
                  retireLabel="Retire Session"
                  status="retired"
                />
              </Stack>
            </PanelBody>
          </Panel>
        </Grid>
      </Stack>

      <RenameSessionDialog
        cancelLabel="Cancel"
        description="Session identity remains unchanged."
        label="Session title"
        onOpenChange={setRenameOpen}
        onSubmit={() => setRenameOpen(false)}
        onTitleChange={setTitle}
        open={renameOpen}
        submitLabel="Rename Session"
        title="Rename Session"
        value={title}
      />
    </GallerySection>
  );
}
