import {
  AgentCatalog,
  AgentConfigForm,
  AgentCreateDialog,
  AgentDetailsView,
  AgentLifecycleActions,
  Button,
  Cluster,
  ConfigSection,
  FormField,
  Grid,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  Textarea,
} from '@ta-agent/ui-react';
import { useState } from 'react';

import { GallerySection } from './gallery-section.js';

const RESEARCH_AGENT = Object.freeze({
  agentId: 'research-assistant',
  displayName: 'Research Assistant',
  identityRevision: 'identity-revision-4',
  status: 'active' as const,
  updatedAt: '2026-01-10T18:30:00.000Z',
});

const AGENTS = Object.freeze([
  RESEARCH_AGENT,
  Object.freeze({
    agentId: 'review-assistant',
    displayName: 'Review Assistant',
    identityRevision: 'identity-revision-2',
    status: 'disabled' as const,
    updatedAt: '2026-01-09T12:00:00.000Z',
  }),
]);

const DETAILS = Object.freeze({
  ...RESEARCH_AGENT,
  createdAt: '2026-01-01T08:00:00.000Z',
});
const STATUS_LABELS = Object.freeze({ active: 'Available', disabled: 'Unavailable' });

export function AgentManagementGallery() {
  const [selectedAgentId, setSelectedAgentId] = useState('research-assistant');
  const [createOpen, setCreateOpen] = useState(false);
  const [identity, setIdentity] = useState({ agentId: '', displayName: '' });
  const [instructions, setInstructions] = useState('Answer with grounded evidence.');

  return (
    <GallerySection
      description="UI-owned Agent view models, controlled configuration slots, and explicit lifecycle capabilities."
      id="agent-management"
      title="Agent management"
    >
      <Stack space="large">
        <Grid columns="two">
          <Panel>
            <PanelHeader>
              <h3>Ready catalog</h3>
            </PanelHeader>
            <PanelBody>
              <AgentCatalog
                createAction={<Button onClick={() => setCreateOpen(true)}>Create Agent</Button>}
                emptyTitle="No Agents"
                loadingLabel="Loading Agents"
                onSelectAgent={setSelectedAgentId}
                selectedAgentId={selectedAgentId}
                state={{ status: 'ready', agents: AGENTS }}
                statusLabels={STATUS_LABELS}
                workingAgentIds={['review-assistant']}
                workingLabel="Updating"
              />
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <h3>Catalog boundary states</h3>
            </PanelHeader>
            <PanelBody>
              <Stack space="medium">
                <AgentCatalog
                  emptyTitle="No Agents"
                  loadingLabel="Loading Agents"
                  onSelectAgent={() => undefined}
                  state={{ status: 'loading' }}
                  statusLabels={STATUS_LABELS}
                  workingLabel="Working"
                />
                <AgentCatalog
                  emptyDescription="Create an Agent to begin."
                  emptyTitle="No Agents"
                  loadingLabel="Loading Agents"
                  onSelectAgent={() => undefined}
                  state={{ status: 'ready', agents: [] }}
                  statusLabels={STATUS_LABELS}
                  workingLabel="Working"
                />
                <AgentCatalog
                  emptyTitle="No Agents"
                  loadingLabel="Loading Agents"
                  onRetry={() => undefined}
                  onSelectAgent={() => undefined}
                  retryLabel="Retry"
                  state={{ status: 'failed', error: 'Catalog unavailable.' }}
                  statusLabels={STATUS_LABELS}
                  workingLabel="Working"
                />
              </Stack>
            </PanelBody>
          </Panel>
        </Grid>

        <AgentDetailsView
          agent={DETAILS}
          formatTimestamp={(timestamp) => new Date(timestamp).toLocaleString('en-US')}
          labels={{
            agentId: 'Agent ID',
            createdAt: 'Created',
            identityRevision: 'Identity revision',
            status: 'Status',
            updatedAt: 'Updated',
          }}
          statusLabels={STATUS_LABELS}
        >
          <p>Application metadata can be composed without widening the Agent details contract.</p>
        </AgentDetailsView>

        <Grid columns="two">
          <Panel>
            <PanelHeader>
              <h3>Dirty configuration</h3>
            </PanelHeader>
            <PanelBody>
              <AgentConfigForm
                cancelLabel="Discard"
                dirty
                onReset={() => undefined}
                onSubmit={() => undefined}
                saveLabel="Save"
              >
                <ConfigSection
                  description="Fields are supplied by the application."
                  title="Interaction"
                >
                  <FormField label="Instructions">
                    {(controlProps) => (
                      <Textarea
                        {...controlProps}
                        onChange={(event) => setInstructions(event.currentTarget.value)}
                        value={instructions}
                      />
                    )}
                  </FormField>
                </ConfigSection>
              </AgentConfigForm>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader>
              <h3>Revision conflict</h3>
            </PanelHeader>
            <PanelBody>
              <AgentConfigForm
                cancelLabel="Discard"
                conflict="Configuration changed after it was loaded."
                conflictActions={
                  <Button appearance="outline" size="small" tone="neutral">
                    Reload
                  </Button>
                }
                dirty
                onReset={() => undefined}
                onSubmit={() => undefined}
                saveLabel="Save"
              >
                <ConfigSection title="Application fields">
                  <p>The component does not interpret the configuration payload.</p>
                </ConfigSection>
              </AgentConfigForm>
            </PanelBody>
          </Panel>
        </Grid>

        <Panel>
          <PanelHeader>
            <h3>Lifecycle capabilities</h3>
          </PanelHeader>
          <PanelBody>
            <Cluster space="large">
              <AgentLifecycleActions
                disableLabel="Disable Agent"
                onRequestDisable={() => undefined}
                reactivateLabel="Reactivate Agent"
                status="active"
              />
              <AgentLifecycleActions
                disableLabel="Disable Agent"
                onReactivate={() => undefined}
                reactivateLabel="Reactivate Agent"
                status="disabled"
              />
            </Cluster>
          </PanelBody>
        </Panel>
      </Stack>

      <AgentCreateDialog
        cancelLabel="Cancel"
        configFields={
          <ConfigSection title="Application configuration">
            <p>Typed application fields are installed through this slot.</p>
          </ConfigSection>
        }
        description="Create an immutable Agent identity."
        identity={identity}
        labels={{ agentId: 'Agent ID', displayName: 'Display name' }}
        onIdentityChange={setIdentity}
        onOpenChange={setCreateOpen}
        onSubmit={() => setCreateOpen(false)}
        open={createOpen}
        submitLabel="Create Agent"
        title="Create Agent"
      />
    </GallerySection>
  );
}
